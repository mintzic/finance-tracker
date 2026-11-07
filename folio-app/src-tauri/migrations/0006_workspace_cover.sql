CREATE TABLE workspace_cover (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  image BLOB NOT NULL,
  position REAL NOT NULL DEFAULT 50 CHECK(position BETWEEN 0 AND 100)
);
