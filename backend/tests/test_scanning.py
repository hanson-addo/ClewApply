"""ClamdScanner against a fake clamd that speaks the INSTREAM protocol."""

import asyncio
from collections.abc import AsyncIterator, Callable

import pytest

from clew.scanning import CHUNK_BYTES, ClamdScanner, ScannerUnavailable, ScanVerdict
from tests.file_helpers import EICAR, FAKE_PDF


class FakeClamd:
    def __init__(self, answer: Callable[[bytes], bytes]) -> None:
        self.answer = answer
        self.received: list[bytes] = []
        self.command = b""

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.command = await reader.readuntil(b"\0")
        data = b""
        while True:
            size = int.from_bytes(await reader.readexactly(4), "big")
            if size == 0:
                break
            data += await reader.readexactly(size)
        self.received.append(data)
        writer.write(self.answer(data))
        await writer.drain()
        writer.close()


def clamav_like(data: bytes) -> bytes:
    return b"stream: Eicar-Signature FOUND\0" if EICAR in data else b"stream: OK\0"


@pytest.fixture
async def clamd() -> AsyncIterator[tuple[FakeClamd, ClamdScanner]]:
    fake = FakeClamd(clamav_like)
    server = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        yield fake, ClamdScanner("127.0.0.1", port, timeout=5)


async def test_clean_file(clamd: tuple[FakeClamd, ClamdScanner]) -> None:
    fake, scanner = clamd
    assert await scanner.scan(FAKE_PDF) is ScanVerdict.CLEAN
    assert fake.command == b"zINSTREAM\0"
    assert fake.received == [FAKE_PDF]


async def test_eicar_is_infected(clamd: tuple[FakeClamd, ClamdScanner]) -> None:
    _, scanner = clamd
    assert await scanner.scan(FAKE_PDF + EICAR) is ScanVerdict.INFECTED


async def test_large_file_is_sent_in_chunks_intact(clamd: tuple[FakeClamd, ClamdScanner]) -> None:
    fake, scanner = clamd
    data = bytes(range(256)) * (CHUNK_BYTES // 256 * 3 + 7)
    assert await scanner.scan(data) is ScanVerdict.CLEAN
    assert fake.received == [data]


@pytest.mark.parametrize(
    "reply",
    [b"INSTREAM size limit exceeded. ERROR\0", b"stream: lstat() failed. ERROR\0", b"\0"],
)
async def test_unclear_reply_fails_closed(reply: bytes) -> None:
    fake = FakeClamd(lambda _: reply)
    server = await asyncio.start_server(fake.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        with pytest.raises(ScannerUnavailable):
            await ClamdScanner("127.0.0.1", port, timeout=5).scan(FAKE_PDF)


async def test_unreachable_scanner_fails_closed() -> None:
    server = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    server.close()
    await server.wait_closed()
    with pytest.raises(ScannerUnavailable):
        await ClamdScanner("127.0.0.1", port, timeout=5).scan(FAKE_PDF)


async def test_silent_scanner_times_out() -> None:
    async def never_answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read()  # takes everything, answers nothing, until the client hangs up
        writer.close()

    server = await asyncio.start_server(never_answer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server:
        with pytest.raises(ScannerUnavailable):
            await ClamdScanner("127.0.0.1", port, timeout=0.2).scan(FAKE_PDF)
