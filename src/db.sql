CREATE TABLE flare_peer_peers ( id TEXT PRIMARY KEY, created_at INTEGER NOT NULL );
CREATE TABLE flare_peer_messages ( id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, destination TEXT, type TEXT, content TEXT, created_at INTEGER NOT NULL );
CREATE INDEX flare_peer_messages_destination_idx ON flare_peer_messages (destination);
