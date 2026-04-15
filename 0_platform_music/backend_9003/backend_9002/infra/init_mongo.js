// =============================================================================
// Music Platform - MongoDB Initialization Script (v2.0)
// Database: music_platform
// Collections: tracks, comments
// =============================================================================

db = db.getSiblingDB("aimu");

// =============================================================================
// tracks collection + indexes
// =============================================================================
db.createCollection("tracks");

db.tracks.createIndex({ uploader_id: 1 });
db.tracks.createIndex({ genre: 1 });
db.tracks.createIndex({ tags: 1 });
db.tracks.createIndex({ ai_model: 1 });
db.tracks.createIndex({ created_at: -1 });
db.tracks.createIndex({ play_count: -1 });
db.tracks.createIndex({ is_public: 1, created_at: -1 });

// =============================================================================
// comments collection + indexes
// =============================================================================
db.createCollection("comments");

db.comments.createIndex({ track_id: 1, created_at: -1 });

print("MongoDB initialization completed: music_platform database with tracks and comments collections.");
