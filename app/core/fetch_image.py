"""Download a picture from a URL someone pasted, and keep a copy.

On a VPS this is the one place the server makes a request somebody else
chose, so it is written against server-side request forgery:

- http and https only, on their ordinary ports or any port above 1023;
- the host name is resolved here, every address it resolves to must be a
  public one (no loopback, private, link-local -- which includes the cloud
  metadata address 169.254.169.254 -- multicast or reserved ranges), and the
  connection is made to that checked address, so a DNS answer that changes
  between the check and the connect (rebinding) cannot redirect it;
- redirects are followed by hand, at most MAX_REDIRECTS, and every hop goes
  through the same checks;
- the body is read in chunks and abandoned past the size cap, under a
  timeout for the whole download.

What comes back is only bytes. Whether they are a picture is decided by
app/core/images.py from the bytes themselves.
"""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit

MAX_REDIRECTS = 4
CONNECT_TIMEOUT = 10
TOTAL_TIMEOUT = 30
CHUNK = 64 * 1024
USER_AGENT = "fmri-experiment-designer/1 (image fetch)"


class FetchError(Exception):
    """A message safe to show to the person who pasted the URL."""


def _public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _resolve(host: str, port: int) -> str:
    """One public address for host, or FetchError. Every address the name
    resolves to must be public, so a name that answers with both a public and
    a private address is refused rather than raced."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise FetchError("that address could not be found") from None
    addresses = [info[4][0] for info in infos]
    if not addresses:
        raise FetchError("that address could not be found")
    if not all(_public(address) for address in addresses):
        raise FetchError("pictures can only be fetched from public internet addresses")
    return addresses[0]


class _PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, host: str, address: str, port: int) -> None:
        super().__init__(host, port, timeout=CONNECT_TIMEOUT)
        self._address = address

    def connect(self) -> None:
        self.sock = socket.create_connection((self._address, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, address: str, port: int) -> None:
        super().__init__(host, port, timeout=CONNECT_TIMEOUT, context=ssl.create_default_context())
        self._address = address

    def connect(self) -> None:
        # Connect to the checked address, but verify the certificate (and send
        # SNI) for the name in the URL, as a browser would.
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _split(url: str) -> tuple[str, str, int, str]:
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        raise FetchError("that is not a web address") from None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise FetchError("only http:// and https:// addresses can be fetched")
    if parts.username or parts.password:
        raise FetchError("addresses with a user name or password in them are not fetched")
    default = 443 if parts.scheme == "https" else 80
    port = port or default
    if port != default and port < 1024:
        raise FetchError("that port is not allowed")
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return parts.scheme, parts.hostname, port, path


def fetch(url: str, max_bytes: int) -> tuple[bytes, str]:
    """Returns (body, final_url)."""
    if not isinstance(url, str) or len(url) > 2048:
        raise FetchError("that is not a web address")
    deadline = time.monotonic() + TOTAL_TIMEOUT
    current = url.strip()
    for _ in range(MAX_REDIRECTS + 1):
        scheme, host, port, path = _split(current)
        address = _resolve(host, port)
        connection_type = _PinnedHTTPSConnection if scheme == "https" else _PinnedHTTPConnection
        connection = connection_type(host, address, port)
        try:
            connection.request("GET", path, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise FetchError("the address redirected nowhere")
                current = urljoin(current, location)
                continue
            if response.status != 200:
                raise FetchError(f"the address answered {response.status}")
            length = response.getheader("Content-Length")
            if length and length.isdigit() and int(length) > max_bytes:
                raise FetchError(f"the picture is larger than {max_bytes // (1024 * 1024)} MB")
            body = bytearray()
            while True:
                if time.monotonic() > deadline:
                    raise FetchError("the download took too long")
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                body += chunk
                if len(body) > max_bytes:
                    raise FetchError(f"the picture is larger than {max_bytes // (1024 * 1024)} MB")
            return bytes(body), current
        except (OSError, http.client.HTTPException, ssl.SSLError) as error:
            if isinstance(error, FetchError):
                raise
            raise FetchError("the picture could not be downloaded") from None
        finally:
            connection.close()
    raise FetchError("the address redirected too many times")
