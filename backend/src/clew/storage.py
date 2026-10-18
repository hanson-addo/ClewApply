"""Object storage for user files. Files are private; users get short-lived signed links."""

import asyncio
import logging
from functools import lru_cache
from typing import TYPE_CHECKING, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from clew.config import get_settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger(__name__)


class StorageUnavailable(Exception):
    """The object store could not be reached or refused the request."""


class ObjectStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...

    async def get(self, key: str, max_bytes: int) -> bytes: ...

    def download_url(
        self, key: str, *, filename: str, content_type: str, expires_in: int
    ) -> str: ...


class S3ObjectStore:
    def __init__(self, client: "S3Client", bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            await asyncio.to_thread(
                self._client.put_object,
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        except (BotoCoreError, ClientError) as exc:
            # The key is random and the error carries no file content, so both are safe to log.
            logger.error("storage_put_failed", extra={"error": type(exc).__name__})
            raise StorageUnavailable from exc

    async def get(self, key: str, max_bytes: int) -> bytes:
        def read() -> bytes:
            body = self._client.get_object(Bucket=self._bucket, Key=key)["Body"]
            try:
                return body.read(max_bytes + 1)
            finally:
                body.close()

        try:
            data = await asyncio.to_thread(read)
        except (BotoCoreError, ClientError) as exc:
            logger.error("storage_get_failed", extra={"error": type(exc).__name__})
            raise StorageUnavailable from exc
        if len(data) > max_bytes:
            # Uploads are capped, so a bigger object means something wrote it outside the API.
            logger.error("storage_object_too_large")
            raise StorageUnavailable
        return data

    def download_url(self, key: str, *, filename: str, content_type: str, expires_in: int) -> str:
        # Signing is local (no network call). "attachment" makes browsers download the file
        # rather than render it, so a crafted PDF can't run in our origin (threat model R7).
        return self._client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{filename}"',
                "ResponseContentType": content_type,
            },
            ExpiresIn=expires_in,
        )


def s3_client(
    *,
    endpoint_url: str | None,
    region: str,
    access_key_id: str | None,
    secret_access_key: str | None,
) -> "S3Client":
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        region_name=region,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        # SigV4 links carry their expiry (X-Amz-Expires, max 7 days). Path-style addressing
        # works with MinIO and AWS alike.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache
def get_object_store() -> ObjectStore | None:
    settings = get_settings()
    if settings.s3_bucket is None:
        return None
    secret = settings.s3_secret_access_key
    client = s3_client(
        endpoint_url=settings.s3_endpoint_url,
        region=settings.s3_region,
        access_key_id=settings.s3_access_key_id,
        secret_access_key=secret.get_secret_value() if secret else None,
    )
    return S3ObjectStore(client, settings.s3_bucket)
