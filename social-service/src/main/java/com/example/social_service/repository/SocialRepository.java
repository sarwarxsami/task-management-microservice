package com.example.social_service.repository;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SocialRepository {

    public record Link(String studentId, Instant createdAt) {
    }

    public record AccessRequest(int id, String requesterId, String ownerId, Instant createdAt) {
    }

    private final JdbcTemplate jdbc;

    public SocialRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- Listed / Unlisted (no row means unlisted) ----

    public boolean isListed(String studentId) {
        return Boolean.TRUE.equals(jdbc.query("SELECT listed FROM profiles WHERE student_id = ?",
                rs -> rs.next() ? rs.getBoolean(1) : false, studentId));
    }

    public void setListed(String studentId, boolean listed) {
        jdbc.update("""
                INSERT INTO profiles (student_id, listed) VALUES (?, ?)
                ON CONFLICT (student_id) DO UPDATE SET listed = EXCLUDED.listed, updated_at = now()
                """, studentId, listed);
    }

    public Set<String> listedIds() {
        return new HashSet<>(jdbc.queryForList("SELECT student_id FROM profiles WHERE listed", String.class));
    }

    // ---- Your Task Viewers (owner -> viewer) ----

    public List<Link> viewersOf(String ownerId) {
        return jdbc.query("SELECT viewer_id, created_at FROM task_viewers WHERE owner_id = ? ORDER BY created_at",
                (rs, i) -> new Link(rs.getString(1), rs.getTimestamp(2).toInstant()), ownerId);
    }

    public List<Link> ownersWhoAdded(String viewerId) {
        return jdbc.query("SELECT owner_id, created_at FROM task_viewers WHERE viewer_id = ? ORDER BY created_at",
                (rs, i) -> new Link(rs.getString(1), rs.getTimestamp(2).toInstant()), viewerId);
    }

    public boolean isViewer(String ownerId, String viewerId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM task_viewers WHERE owner_id = ? AND viewer_id = ?)",
                Boolean.class, ownerId, viewerId));
    }

    public boolean addViewer(String ownerId, String viewerId) {
        return jdbc.update("""
                INSERT INTO task_viewers (owner_id, viewer_id) VALUES (?, ?)
                ON CONFLICT DO NOTHING
                """, ownerId, viewerId) > 0;
    }

    public boolean removeViewer(String ownerId, String viewerId) {
        return jdbc.update("DELETE FROM task_viewers WHERE owner_id = ? AND viewer_id = ?", ownerId, viewerId) > 0;
    }

    // ---- Viewer Access Requests (requester asks owner) ----

    public List<AccessRequest> requestsTo(String ownerId) {
        return jdbc.query("SELECT id, requester_id, owner_id, created_at FROM viewer_access_requests WHERE owner_id = ? ORDER BY created_at",
                this::mapRequest, ownerId);
    }

    public List<AccessRequest> requestsFrom(String requesterId) {
        return jdbc.query("SELECT id, requester_id, owner_id, created_at FROM viewer_access_requests WHERE requester_id = ? ORDER BY created_at",
                this::mapRequest, requesterId);
    }

    public Optional<AccessRequest> findRequest(int id) {
        return jdbc.query("SELECT id, requester_id, owner_id, created_at FROM viewer_access_requests WHERE id = ?",
                this::mapRequest, id).stream().findFirst();
    }

    // Returns empty when the same request already exists
    public Optional<Integer> createRequest(String requesterId, String ownerId) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                    "INSERT INTO viewer_access_requests (requester_id, owner_id) VALUES (?, ?) RETURNING id",
                    Integer.class, requesterId, ownerId));
        } catch (DuplicateKeyException e) {
            return Optional.empty();
        }
    }

    public void deleteRequest(int id) {
        jdbc.update("DELETE FROM viewer_access_requests WHERE id = ?", id);
    }

    private AccessRequest mapRequest(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new AccessRequest(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant());
    }
}
