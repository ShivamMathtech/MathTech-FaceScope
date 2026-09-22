import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from server.app import make_server


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.server = make_server(0, cls.tmp.name)
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def request(self, path, method='GET', data=None, headers=None):
        body = json.dumps(data).encode() if data is not None else None
        h = {'X-FaceScope': '1', 'Content-Type': 'application/json', **(headers or {})}
        try:
            response = urlopen(Request(self.url + path, data=body, method=method, headers=h))
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, response.read(), response.headers

    def session(self):
        return {'schema_version': 1, 'name': 'Unit test', 'samples': [
            {'time': 0, 'detected': True, 'eye_left': .3}, {'time': .1, 'detected': False}]}

    def test_crud(self):
        status, body, _ = self.request('/api/sessions', 'POST', self.session())
        self.assertEqual(status, 201)
        sid = json.loads(body)['id']
        status, body, _ = self.request('/api/sessions/' + sid)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['summary']['tracking_percent'], 50)
        self.assertEqual(self.request('/api/sessions/' + sid, 'DELETE')[0], 200)
        self.assertEqual(self.request('/api/sessions/' + sid)[0], 404)

    def test_rejects_cross_origin_mutation(self):
        self.assertEqual(self.request('/api/sessions', 'POST', self.session(), {'Origin': 'https://example.com'})[0], 403)

    def test_rejects_missing_marker(self):
        self.assertEqual(self.request('/api/sessions', 'POST', self.session(), {'X-FaceScope': ''})[0], 403)

    def test_rejects_rebinding(self):
        self.assertEqual(self.request('/api/health', headers={'Host': 'attacker.example'})[0], 403)

    def test_rejects_traversal(self):
        self.assertEqual(self.request('/%2e%2e/server/app.py')[0], 403)

    def test_nonfinite_invalid(self):
        data = self.session()
        data['samples'][0]['eye_left'] = float('nan')
        self.assertEqual(self.request('/api/sessions', 'POST', data)[0], 400)

    def test_unordered_timestamps_invalid(self):
        data = self.session()
        data['samples'][1]['time'] = -1
        self.assertEqual(self.request('/api/sessions', 'POST', data)[0], 400)

    def test_overflow_floats_invalid(self):
        data = self.session()
        data['samples'][0]['time'] = float('inf')
        self.assertEqual(self.request('/api/sessions', 'POST', data)[0], 400)

    def test_empty_data_invalid(self):
        data = self.session()
        data['samples'] = []
        self.assertEqual(self.request('/api/sessions', 'POST', data)[0], 400)

    def test_module_mime_and_headers(self):
        status, _, headers = self.request('/metrics.js')
        self.assertEqual(status, 200)
        self.assertIn('javascript', headers['Content-Type'])
        self.assertIn("frame-ancestors 'none'", headers['Content-Security-Policy'])

    def test_source_not_exposed(self):
        self.assertEqual(self.request('/server/app.py')[0], 404)
        self.assertEqual(self.request('/data/facescope.sqlite3')[0], 404)


if __name__ == '__main__':
    unittest.main()
