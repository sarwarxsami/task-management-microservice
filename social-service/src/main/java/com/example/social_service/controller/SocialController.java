package com.example.social_service.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.example.social_service.dto.Dtos.Audience;
import com.example.social_service.dto.Dtos.AudienceBody;
import com.example.social_service.dto.Dtos.DiscoverEntry;
import com.example.social_service.dto.Dtos.GroupBody;
import com.example.social_service.dto.Dtos.GroupView;
import com.example.social_service.dto.Dtos.Groups;
import com.example.social_service.dto.Dtos.OpenTask;
import com.example.social_service.dto.Dtos.Requests;
import com.example.social_service.dto.Dtos.Settings;
import com.example.social_service.dto.Dtos.Space;
import com.example.social_service.dto.Dtos.UsernameBody;
import com.example.social_service.dto.Dtos.UsernamesBody;
import com.example.social_service.dto.Dtos.ViewTasksEntry;
import com.example.social_service.dto.Dtos.Viewer;
import com.example.social_service.dto.Dtos.WhoCanSee;
import com.example.social_service.exception.ApiException;
import com.example.social_service.service.SocialService;
import com.example.social_service.service.SocialService.Caller;

@RestController
@RequestMapping("/service/social-service")
public class SocialController {
    private final SocialService service;

    public SocialController(SocialService service) {
        this.service = service;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @GetMapping("/settings")
    public Settings getSettings(@AuthenticationPrincipal Jwt jwt) {
        return new Settings(service.isListed(caller(jwt)));
    }

    @PutMapping("/settings")
    public Settings updateSettings(@AuthenticationPrincipal Jwt jwt, @RequestBody Settings body) {
        if (body.listed() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "listed is required");
        }
        return new Settings(service.setListed(caller(jwt), body.listed()));
    }

    @GetMapping("/discover")
    public List<DiscoverEntry> discover(@AuthenticationPrincipal Jwt jwt) {
        return service.discover(caller(jwt));
    }

    @GetMapping("/open-tasks")
    public List<OpenTask> openTasks(@AuthenticationPrincipal Jwt jwt) {
        return service.openTasks(caller(jwt));
    }

    @GetMapping("/spaces/{username}")
    public Space space(@AuthenticationPrincipal Jwt jwt, @PathVariable String username) {
        return service.space(caller(jwt), username);
    }

    @GetMapping("/viewers")
    public List<Viewer> viewers(@AuthenticationPrincipal Jwt jwt) {
        return service.viewers(caller(jwt));
    }

    @PostMapping("/viewers")
    public ResponseEntity<Void> addViewer(@AuthenticationPrincipal Jwt jwt, @RequestBody UsernameBody body) {
        service.addViewer(caller(jwt), body.username());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/viewers/{username}")
    public ResponseEntity<Void> removeViewer(@AuthenticationPrincipal Jwt jwt, @PathVariable String username) {
        service.removeViewer(caller(jwt), username);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/view-tasks")
    public List<ViewTasksEntry> viewTasks(@AuthenticationPrincipal Jwt jwt) {
        return service.viewTasks(caller(jwt));
    }

    @GetMapping("/requests")
    public Requests requests(@AuthenticationPrincipal Jwt jwt) {
        return service.requests(caller(jwt));
    }

    @PostMapping("/requests")
    public ResponseEntity<Map<String, Integer>> sendRequest(@AuthenticationPrincipal Jwt jwt, @RequestBody UsernameBody body) {
        int id = service.sendRequest(caller(jwt), body.username());
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("id", id));
    }

    @PostMapping("/requests/{id}/accept")
    public ResponseEntity<Void> accept(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.acceptRequest(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/requests/{id}/decline")
    public ResponseEntity<Void> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.declineRequest(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/requests/{id}")
    public ResponseEntity<Void> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.cancelRequest(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/audiences")
    public List<Audience> audiences(@AuthenticationPrincipal Jwt jwt) {
        return service.audiences(caller(jwt));
    }

    @PutMapping("/tasks/{id}/audience")
    public Audience setAudience(@AuthenticationPrincipal Jwt jwt, @PathVariable int id, @RequestBody AudienceBody body) {
        return service.setAudience(caller(jwt), id, body);
    }

    @DeleteMapping("/tasks/{id}/audience")
    public ResponseEntity<Void> clearAudience(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.clearAudience(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/tasks/{id}/who-can-see")
    public WhoCanSee whoCanSee(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        return service.whoCanSee(caller(jwt), id);
    }

    @GetMapping("/groups")
    public Groups groups(@AuthenticationPrincipal Jwt jwt) {
        return service.groups(caller(jwt));
    }

    @PostMapping("/groups")
    public ResponseEntity<GroupView> createGroup(@AuthenticationPrincipal Jwt jwt, @RequestBody GroupBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createGroup(caller(jwt), body.name()));
    }

    @PutMapping("/groups/{id}")
    public GroupView renameGroup(@AuthenticationPrincipal Jwt jwt, @PathVariable int id, @RequestBody GroupBody body) {
        return service.renameGroup(caller(jwt), id, body.name());
    }

    @DeleteMapping("/groups/{id}")
    public ResponseEntity<Void> deleteGroup(@AuthenticationPrincipal Jwt jwt, @PathVariable int id) {
        service.deleteGroup(caller(jwt), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/groups/{id}/members")
    public GroupView addGroupMembers(@AuthenticationPrincipal Jwt jwt, @PathVariable int id, @RequestBody UsernamesBody body) {
        return service.addGroupMembers(caller(jwt), id, body.usernames());
    }

    @DeleteMapping("/groups/{id}/members/{username}")
    public ResponseEntity<Void> removeGroupMember(@AuthenticationPrincipal Jwt jwt, @PathVariable int id,
            @PathVariable String username) {
        service.removeGroupMember(caller(jwt), id, username);
        return ResponseEntity.noContent().build();
    }

    private static Caller caller(Jwt jwt) {
        return new Caller(jwt.getSubject());
    }
}
