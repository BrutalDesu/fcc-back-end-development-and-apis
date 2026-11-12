# Back End Development and APIs — freeCodeCamp certification

Five microservices for the freeCodeCamp *Back End Development and APIs* certification
(<https://www.freecodecamp.org/learn/back-end-development-and-apis/>).

Implemented with the **Node.js standard library only** — no Express, no dependencies, no
build step. One `server.js` hosts every service; the `API` environment variable selects
which one to run.

| Service | `API` | Port | Endpoints |
| --- | --- | --- | --- |
| Timestamp Microservice | `timestamp` | 3001 | `GET /api/:date` |
| Request Header Parser Microservice | `headers` | 3002 | `GET /api/whoami` |
| URL Shortener Microservice | `shorturl` | 3003 | `POST /api/shorturl`, `GET /api/shorturl/:id` |
| Exercise Tracker | `exercises` | 3004 | `GET|POST /api/users`, `POST /api/users/:id/exercises`, `GET /api/users/:id/logs` |
| File Metadata Microservice | `filemetadata` | 3005 | `POST /api/fileanalyse` |

## Run

```bash
API=timestamp PORT=3001 node server.js
```

## Endpoints in detail

### Timestamp Microservice
* `GET /api/1451001600000` -> `{"unix":1451001600000,"utc":"Fri, 25 Dec 2015 00:00:00 GMT"}`
* `GET /api/2015-12-25` -> the same timestamp
* `GET /api/notadate` -> `{"error":"Invalid Date"}`
* `GET /api/` -> the current time

### Request Header Parser Microservice
* `GET /api/whoami` -> `{"ipaddress":"...","language":"...","software":"..."}`

### URL Shortener Microservice
* `POST /api/shorturl` with `url=http://www.example.com` -> `{"original_url":"...","short_url":1}`
* `POST /api/shorturl` with an invalid url -> `{"error":"invalid url"}`
* `GET /api/shorturl/:id` -> `302` redirect to the original URL

### Exercise Tracker
* `POST /api/users` (`username=...`) -> `{"username":"...","_id":"..."}`
* `GET /api/users` -> array of `{username, _id}`
* `POST /api/users/:id/exercises` (`description`, `duration`, optional `date`) -> the user
  object with the exercise fields added
* `GET /api/users/:id/logs` -> `{username, _id, count, log:[{description, duration, date}]}`
* `?from=&to=&limit=` filter the log (`from`/`to` are `yyyy-mm-dd`)

### File Metadata Microservice
* `POST /api/fileanalyse` with a multipart form field named `upfile`
  -> `{"name":"...","type":"...","size":123}`

## Notes

* Multipart uploads are parsed by a small hand-written reader, so the service keeps its
  zero-dependency guarantee.
* The shortener and the exercise tracker keep their state in memory, which is enough for
  the certification test suites.
* The services are published with a Cloudflare quick tunnel for live grading:

```bash
cloudflared tunnel --url http://127.0.0.1:3001
```
