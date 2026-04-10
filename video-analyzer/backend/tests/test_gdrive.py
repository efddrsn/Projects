import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import gdrive


class DownloadFromGDriveTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.original_temp_dir = gdrive.settings.temp_dir
        gdrive.settings.temp_dir = Path(self.tmp_dir.name)

    def tearDown(self):
        gdrive.settings.temp_dir = self.original_temp_dir
        self.tmp_dir.cleanup()

    async def test_virus_scan_html_flow_streams_without_reusing_response_body(self):
        file_id = "testfileid1234567890abc"
        input_url = f"https://drive.google.com/file/d/{file_id}/view"
        html = f"""
        <html>
          <body>
            <h1>Virus scan warning</h1>
            <form id="download-form" action="https://drive.usercontent.google.com/download">
              <input type="hidden" name="id" value="{file_id}">
              <input type="hidden" name="confirm" value="abc123">
            </form>
          </body>
        </html>
        """
        video_bytes = b"\x00\x00\x00\x18ftypmp42payload"

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "drive.google.com":
                return httpx.Response(
                    200,
                    headers={"content-type": "text/html"},
                    content=html.encode("utf-8"),
                )
            if request.url.host == "drive.usercontent.google.com" and request.url.path == "/download":
                return httpx.Response(
                    200,
                    headers={"content-type": "video/mp4"},
                    content=video_bytes,
                )
            return httpx.Response(404, content=b"not found")

        transport = httpx.MockTransport(handler)
        real_async_client = httpx.AsyncClient

        def async_client_factory(*args, **kwargs):
            kwargs["transport"] = transport
            return real_async_client(*args, **kwargs)

        with patch("app.gdrive.httpx.AsyncClient", side_effect=async_client_factory):
            output_path = await gdrive.download_from_gdrive(input_url, timeout=10.0)

        self.assertTrue(output_path.exists())
        self.assertEqual(output_path.read_bytes(), video_bytes)

    async def test_direct_download_streams_to_disk(self):
        file_id = "directdownloadid1234567890"
        input_url = f"https://drive.google.com/file/d/{file_id}/view"
        video_bytes = b"\x00\x00\x00\x18ftypmp42" + (b"x" * 1024)

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "drive.google.com":
                return httpx.Response(
                    200,
                    headers={"content-type": "video/mp4"},
                    content=video_bytes,
                )
            return httpx.Response(404, content=b"not found")

        transport = httpx.MockTransport(handler)
        real_async_client = httpx.AsyncClient

        def async_client_factory(*args, **kwargs):
            kwargs["transport"] = transport
            return real_async_client(*args, **kwargs)

        with patch("app.gdrive.httpx.AsyncClient", side_effect=async_client_factory):
            output_path = await gdrive.download_from_gdrive(input_url, timeout=10.0)

        self.assertTrue(output_path.exists())
        self.assertEqual(output_path.read_bytes(), video_bytes)
