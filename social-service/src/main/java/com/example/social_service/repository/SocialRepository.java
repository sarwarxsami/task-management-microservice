package com.example.social_service.repository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

    public record Group(int id, String name, Set<String> members) {
    }

    public record GroupMembership(Set<Integer> groupIds, Set<String> groupedUnder) {
    }

    // mode is "picked" (people) or "groups" (groupIds, plus the Default group when includeDefault)
    public record TaskAudience(String mode, boolean includeDefault, Set<String> people, Set<Integer> groupIds) {
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

    // ---- Groups inside Your Task Viewers (viewers in no group form the Default group) ----

    public List<Group> groupsOf(String ownerId) {
        Map<Integer, Group> groups = new LinkedHashMap<>();
        jdbc.query("""
                SELECT g.id, g.name, m.viewer_id FROM viewer_groups g
                LEFT JOIN viewer_group_members m ON m.group_id = g.id
                WHERE g.owner_id = ?
                ORDER BY lower(g.name), g.id
                """, rs -> {
            int id = rs.getInt(1);
            String name = rs.getString(2);
            String member = rs.getString(3);
            Group g = groups.computeIfAbsent(id, k -> new Group(k, name, new HashSet<>()));
            if (member != null) {
                g.members().add(member);
            }
        }, ownerId);
        return new ArrayList<>(groups.values());
    }

    public int countGroups(String ownerId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM viewer_groups WHERE owner_id = ?", Integer.class, ownerId);
        return n == null ? 0 : n;
    }

    // Throws DuplicateKeyException when the owner already has a group with that name (case-insensitive)
    public int createGroup(String ownerId, String name) {
        Integer id = jdbc.queryForObject("INSERT INTO viewer_groups (owner_id, name) VALUES (?, ?) RETURNING id",
                Integer.class, ownerId, name);
        return id == null ? 0 : id;
    }

    public boolean renameGroup(String ownerId, int groupId, String name) {
        return jdbc.update("UPDATE viewer_groups SET name = ? WHERE id = ? AND owner_id = ?", name, groupId, ownerId) > 0;
    }

    public boolean deleteGroup(String ownerId, int groupId) {
        return jdbc.update("DELETE FROM viewer_groups WHERE id = ? AND owner_id = ?", groupId, ownerId) > 0;
    }

    public void addGroupMembers(int groupId, Collection<String> viewerIds) {
        for (String viewerId : viewerIds) {
            jdbc.update("INSERT INTO viewer_group_members (group_id, viewer_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
                    groupId, viewerId);
        }
    }

    public boolean removeGroupMember(int groupId, String viewerId) {
        return jdbc.update("DELETE FROM viewer_group_members WHERE group_id = ? AND viewer_id = ?", groupId, viewerId) > 0;
    }

    // Someone taken off Your Task Viewers leaves all of that owner's groups
    public void removeFromAllGroups(String ownerId, String viewerId) {
        jdbc.update("""
                DELETE FROM viewer_group_members m USING viewer_groups g
                WHERE m.group_id = g.id AND g.owner_id = ? AND m.viewer_id = ?
                """, ownerId, viewerId);
    }

    // The groups a viewer is in, and the owners under whom they are in at least one group
    public GroupMembership membershipOf(String viewerId) {
        Set<Integer> groupIds = new HashSet<>();
        Set<String> groupedUnder = new HashSet<>();
        jdbc.query("""
                SELECT g.id, g.owner_id FROM viewer_group_members m
                JOIN viewer_groups g ON g.id = m.group_id
                WHERE m.viewer_id = ?
                """, rs -> {
            groupIds.add(rs.getInt(1));
            groupedUnder.add(rs.getString(2));
        }, viewerId);
        return new GroupMembership(groupIds, groupedUnder);
    }

    // ---- Trusted task audiences (row in task_audiences = Hand-picked or Groups, none = All Trusted) ----

    // Audiences of those of the given tasks that have one
    public Map<Integer, TaskAudience> audiences(Collection<Integer> taskIds) {
        Map<Integer, TaskAudience> result = new HashMap<>();
        if (taskIds.isEmpty()) {
            return result;
        }
        String in = String.join(",", Collections.nCopies(taskIds.size(), "?"));
        Object[] args = taskIds.toArray();
        jdbc.query("SELECT task_id, mode, include_default FROM task_audiences WHERE task_id IN (%s)".formatted(in),
                rs -> {
                    result.put(rs.getInt(1), new TaskAudience(rs.getString(2), rs.getBoolean(3), new HashSet<>(), new HashSet<>()));
                }, args);
        if (result.isEmpty()) {
            return result;
        }
        jdbc.query("SELECT task_id, viewer_id FROM task_audience_members WHERE task_id IN (%s)".formatted(in),
                rs -> {
                    result.get(rs.getInt(1)).people().add(rs.getString(2));
                }, args);
        jdbc.query("SELECT task_id, group_id FROM task_audience_groups WHERE task_id IN (%s)".formatted(in),
                rs -> {
                    result.get(rs.getInt(1)).groupIds().add(rs.getInt(2));
                }, args);
        return result;
    }

    public void setPickedAudience(int taskId, Collection<String> viewerIds) {
        resetAudience(taskId, "picked", false);
        for (String viewerId : viewerIds) {
            jdbc.update("INSERT INTO task_audience_members (task_id, viewer_id) VALUES (?, ?)", taskId, viewerId);
        }
    }

    public void setGroupAudience(int taskId, Collection<Integer> groupIds, boolean includeDefault) {
        resetAudience(taskId, "groups", includeDefault);
        for (int groupId : groupIds) {
            jdbc.update("INSERT INTO task_audience_groups (task_id, group_id) VALUES (?, ?)", taskId, groupId);
        }
    }

    public void clearAudience(int taskId) {
        jdbc.update("DELETE FROM task_audiences WHERE task_id = ?", taskId);
    }

    private void resetAudience(int taskId, String mode, boolean includeDefault) {
        jdbc.update("""
                INSERT INTO task_audiences (task_id, mode, include_default) VALUES (?, ?, ?)
                ON CONFLICT (task_id) DO UPDATE SET mode = EXCLUDED.mode, include_default = EXCLUDED.include_default
                """, taskId, mode, includeDefault);
        jdbc.update("DELETE FROM task_audience_members WHERE task_id = ?", taskId);
        jdbc.update("DELETE FROM task_audience_groups WHERE task_id = ?", taskId);
    }

    private AccessRequest mapRequest(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new AccessRequest(rs.getInt(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant());
    }
}
