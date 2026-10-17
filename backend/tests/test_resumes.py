import uuid
from collections.abc import AsyncIterator, Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from botocore.stub import Stubber
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from clew.auth.deps import get_token_verifier
from clew.main import create_app
from clew.models import Resume
from clew.resumes.files import DOCX, MAX_RESUME_BYTES, PDF, detect_resume_type, safe_filename
from clew.storage import S3ObjectStore, StorageUnavailable, get_object_store, s3_client
from tests.auth_helpers import SigningKey, make_token
from tests.file_helpers import FAKE_PDF, docx, pdf_of_size, plain_zip
from tests.test_auth import verifier

KEY = SigningKey("kid_resumes")


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail = False

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        if self.fail:
            raise StorageUnavailable
        self.objects[key] = (data, content_type)

    def download_url(self, key: str, *, filename: str, content_type: str, expires_in: int) -> str:
        return f"https://storage.test/{key}?filename={filename}&expires={expires_in}"


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
async def api(store: MemoryStore) -> AsyncIterator[AsyncClient]:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: store
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def as_user(sub: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(KEY, sub=sub, email=f'{sub}@example.test')}"}


def upload(
    name: str, data: bytes, content_type: str = "application/octet-stream"
) -> dict[str, tuple[str, bytes, str]]:
    return {"file": (name, data, content_type)}


# --- upload --------------------------------------------------------------------------------


async def test_upload_pdf(api: AsyncClient, store: MemoryStore, db: AsyncSession) -> None:
    response = await api.post(
        "/resumes", headers=as_user("user_up_pdf"), files=upload("Jordan CV.pdf", FAKE_PDF)
    )

    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "Jordan CV.pdf"
    assert body["content_type"] == PDF
    assert body["size_bytes"] == len(FAKE_PDF)
    row = await db.scalar(select(Resume).where(Resume.id == uuid.UUID(body["id"])))
    assert row is not None
    assert store.objects[row.file_key] == (FAKE_PDF, PDF)
    # The storage key is random: no user id or file name in it.
    assert "Jordan" not in row.file_key
    assert str(row.user_id) not in row.file_key


async def test_upload_docx(api: AsyncClient) -> None:
    response = await api.post(
        "/resumes", headers=as_user("user_up_docx"), files=upload("resume.docx", docx())
    )
    assert response.status_code == 201
    assert response.json()["content_type"] == DOCX


async def test_type_comes_from_content_not_name(api: AsyncClient) -> None:
    response = await api.post(
        "/resumes", headers=as_user("user_up_rename"), files=upload("resume.docx", FAKE_PDF)
    )
    assert response.status_code == 201
    assert response.json()["content_type"] == PDF
    assert response.json()["filename"] == "resume.pdf"


@pytest.mark.parametrize(
    ("name", "data"),
    [
        ("resume.pdf", b"just some text pretending to be a pdf"),
        ("resume.docx", plain_zip()),
        ("resume.docx", docx(extra_parts=("word/vbaProject.bin",))),
        ("resume.docx", b"PK\x03\x04 not really a zip"),
        ("resume.pdf", b""),
    ],
    ids=["text", "zip-not-word", "macro-docx", "broken-zip", "empty"],
)
async def test_wrong_type_is_rejected(
    api: AsyncClient, store: MemoryStore, name: str, data: bytes
) -> None:
    response = await api.post(
        "/resumes", headers=as_user("user_up_wrong"), files=upload(name, data)
    )
    assert response.status_code == 415
    assert response.json()["detail"] == "Upload a PDF or Word (.docx) file."
    assert store.objects == {}


async def test_exactly_10_mb_is_accepted(api: AsyncClient) -> None:
    data = pdf_of_size(MAX_RESUME_BYTES)
    response = await api.post(
        "/resumes", headers=as_user("user_up_10mb"), files=upload("big.pdf", data)
    )
    assert response.status_code == 201
    assert response.json()["size_bytes"] == MAX_RESUME_BYTES


async def test_one_byte_over_10_mb_is_rejected(api: AsyncClient, store: MemoryStore) -> None:
    data = pdf_of_size(MAX_RESUME_BYTES + 1)
    response = await api.post(
        "/resumes", headers=as_user("user_up_over"), files=upload("big.pdf", data)
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "Files must be 10 MB or smaller."
    assert store.objects == {}


async def test_huge_declared_body_is_refused_before_reading(api: AsyncClient) -> None:
    headers = {**as_user("user_up_huge"), "Content-Length": str(50 * 1024 * 1024)}
    response = await api.post("/resumes", headers=headers, content=b"x")
    assert response.status_code == 413


async def test_huge_chunked_body_is_cut_off(api: AsyncClient, store: MemoryStore) -> None:
    boundary = "clewtestboundary"

    async def body() -> AsyncIterator[bytes]:
        yield (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            'filename="big.pdf"\r\nContent-Type: application/pdf\r\n\r\n'
        ).encode()
        chunk = b"%" * (1024 * 1024)
        for _ in range(12):
            yield chunk
        yield f"\r\n--{boundary}--\r\n".encode()

    headers = {
        **as_user("user_up_chunked"),
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    response = await api.post("/resumes", headers=headers, content=body())
    assert response.status_code == 413
    assert store.objects == {}


async def test_upload_needs_sign_in(api: AsyncClient) -> None:
    response = await api.post("/resumes", files=upload("resume.pdf", FAKE_PDF))
    assert response.status_code == 401


async def test_storage_failure_is_503(
    api: AsyncClient, store: MemoryStore, db: AsyncSession
) -> None:
    store.fail = True
    sub = "user_up_storage_down"
    response = await api.post("/resumes", headers=as_user(sub), files=upload("r.pdf", FAKE_PDF))
    assert response.status_code == 503
    saved = (await db.scalars(select(Resume.filename))).all()
    assert "r.pdf" not in saved


async def test_storage_not_configured_is_503() -> None:
    app = create_app()
    test_verifier = verifier(KEY)
    app.dependency_overrides[get_token_verifier] = lambda: test_verifier
    app.dependency_overrides[get_object_store] = lambda: None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        response = await c.post(
            "/resumes", headers=as_user("user_up_nostore"), files=upload("r.pdf", FAKE_PDF)
        )
    assert response.status_code == 503


# --- download ------------------------------------------------------------------------------


async def uploaded(api: AsyncClient, sub: str) -> str:
    response = await api.post(
        "/resumes", headers=as_user(sub), files=upload("Jordan CV.pdf", FAKE_PDF)
    )
    assert response.status_code == 201
    resume_id: str = response.json()["id"]
    return resume_id


async def test_owner_gets_a_5_minute_link(api: AsyncClient) -> None:
    resume_id = await uploaded(api, "user_dl_owner")
    response = await api.get(f"/resumes/{resume_id}/download", headers=as_user("user_dl_owner"))

    assert response.status_code == 200
    body = response.json()
    assert "expires=300" in body["url"]
    assert "filename=Jordan CV.pdf" in body["url"]


async def test_other_users_resume_is_not_found(api: AsyncClient) -> None:
    resume_id = await uploaded(api, "user_dl_alice")
    response = await api.get(f"/resumes/{resume_id}/download", headers=as_user("user_dl_bob"))
    assert response.status_code == 404
    unknown = await api.get(f"/resumes/{uuid.uuid4()}/download", headers=as_user("user_dl_bob"))
    assert unknown.status_code == 404
    assert response.json() == unknown.json()


async def test_deleted_resume_is_not_found(api: AsyncClient, db: AsyncSession) -> None:
    resume_id = await uploaded(api, "user_dl_deleted")
    await db.execute(
        update(Resume).where(Resume.id == uuid.UUID(resume_id)).values(deleted_at=Resume.created_at)
    )
    await db.commit()
    response = await api.get(f"/resumes/{resume_id}/download", headers=as_user("user_dl_deleted"))
    assert response.status_code == 404


async def test_download_needs_sign_in(api: AsyncClient) -> None:
    response = await api.get(f"/resumes/{uuid.uuid4()}/download")
    assert response.status_code == 401


# --- S3 store ------------------------------------------------------------------------------


@pytest.fixture
def s3() -> Iterator[S3ObjectStore]:
    client = s3_client(
        endpoint_url="http://localhost:9000",
        region="us-east-1",
        access_key_id="test-access-key",
        secret_access_key="test-secret-key",  # noqa: S106 - fake key, signing is local
    )
    yield S3ObjectStore(client, "clew-test")


def test_signed_link_downloads_as_attachment_and_expires(s3: S3ObjectStore) -> None:
    url = s3.download_url("resumes/abc", filename="Jordan CV.pdf", content_type=PDF, expires_in=300)
    query = parse_qs(urlparse(url).query)

    assert urlparse(url).path == "/clew-test/resumes/abc"
    assert query["X-Amz-Expires"] == ["300"]
    assert query["response-content-disposition"] == ['attachment; filename="Jordan CV.pdf"']
    assert query["response-content-type"] == [PDF]


async def test_put_sends_the_object(s3: S3ObjectStore) -> None:
    with Stubber(s3._client) as stub:
        stub.add_response(
            "put_object",
            {},
            {"Bucket": "clew-test", "Key": "resumes/abc", "Body": FAKE_PDF, "ContentType": PDF},
        )
        await s3.put("resumes/abc", FAKE_PDF, PDF)
        stub.assert_no_pending_responses()


async def test_put_failure_raises_storage_unavailable(s3: S3ObjectStore) -> None:
    with Stubber(s3._client) as stub:
        stub.add_client_error("put_object", service_error_code="ServiceUnavailable")
        with pytest.raises(StorageUnavailable):
            await s3.put("resumes/abc", FAKE_PDF, PDF)


# --- file checks ---------------------------------------------------------------------------


def test_detect_resume_type() -> None:
    assert detect_resume_type(FAKE_PDF) == PDF
    assert detect_resume_type(docx()) == DOCX
    assert detect_resume_type(plain_zip()) is None
    assert detect_resume_type(b"\xd0\xcf\x11\xe0 old .doc") is None


@pytest.mark.parametrize(
    ("original", "expected"),
    [
        ("Jordan CV.pdf", "Jordan CV.pdf"),
        ("../../etc/passwd", "passwd.pdf"),
        ("C:\\Users\\jordan\\My Resume.pdf", "My Resume.pdf"),
        ('evil"; name=x.pdf', "evil namex.pdf"),
        ("résumé.pdf", "rsum.pdf"),
        (None, "resume.pdf"),
        ("....pdf", "resume.pdf"),
        ("a" * 300 + ".pdf", "a" * 100 + ".pdf"),
    ],
)
def test_safe_filename(original: str | None, expected: str) -> None:
    assert safe_filename(original, PDF) == expected
