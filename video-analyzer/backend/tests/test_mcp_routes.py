import unittest

from app.main import app


class MCPRouteRegistrationTests(unittest.TestCase):
    def test_mcp_routes_are_registered(self):
        path_methods: dict[str, set[str]] = {}

        for route in app.router.routes:
            path = getattr(route, "path", None)
            methods = set(getattr(route, "methods", set()) or set())
            if path:
                path_methods.setdefault(path, set()).update(methods)

        sse_methods = path_methods.get("/mcp", set()) | path_methods.get("/mcp/", set())
        message_methods = path_methods.get("/mcp/messages", set()) | path_methods.get(
            "/mcp/messages/", set()
        )

        self.assertIn("GET", sse_methods)
        self.assertIn("POST", message_methods)
