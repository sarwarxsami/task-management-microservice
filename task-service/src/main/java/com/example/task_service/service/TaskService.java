package com.example.task_service.service;

import java.util.List;
import java.util.Set;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.task_service.dto.TaskRequest;
import com.example.task_service.exception.ApiException;
import com.example.task_service.model.Task;
import com.example.task_service.repository.TaskRepository;

@Service
public class TaskService {

    private static final Set<String> PRIORITIES = Set.of("low", "medium", "high");
    public static final Set<String> VISIBILITIES = Set.of("only_me", "trusted", "open");
    public static final int MAX_SHARING_LIMIT = 500;
    private static final Sort NEWEST_FIRST = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
    private static final int MAX_TITLE = 200;
    private static final int MAX_DESCRIPTION = 2000;

    private final TaskRepository repository;

    public TaskService(TaskRepository repository) {
        this.repository = repository;
    }

    public List<Task> getTasks(String owner) {
        return repository.findByStudentIdOrderByCreatedAtDescIdDesc(owner);
    }

    public Task addTask(String owner, TaskRequest request) {
        Task task = new Task();
        task.setStudentId(owner);
        apply(task, request);

        try {
            return repository.saveAndFlush(task);
        } catch (DataIntegrityViolationException e) {
            // tasks.student_id has a foreign key to users.student_id
            throw new ApiException(HttpStatus.NOT_FOUND, "User not found");
        }
    }

    public Task updateTask(String owner, int id, TaskRequest request) {
        Task task = findOwned(owner, id);
        apply(task, request);
        return repository.save(task);
    }

    public Task setStatus(String owner, int id, boolean completed) {
        Task task = findOwned(owner, id);
        task.setCompleted(completed);
        return repository.save(task);
    }

    public void deleteTask(String owner, int id) {
        repository.delete(findOwned(owner, id));
    }

    // Used by social-service, which decides who may see what. Newest first; limit (1-500) is applied in the database.
    public List<Task> findForSharing(List<String> studentIds, List<String> visibilities, String excludedStudentId, Integer limit) {
        if (visibilities.isEmpty() || !VISIBILITIES.containsAll(visibilities)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid visibilities");
        }
        if (limit != null && (limit < 1 || limit > MAX_SHARING_LIMIT)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "limit must be 1-" + MAX_SHARING_LIMIT);
        }
        Pageable page = limit == null ? Pageable.unpaged(NEWEST_FIRST) : PageRequest.of(0, limit, NEWEST_FIRST);

        if (!studentIds.isEmpty()) {
            return repository.findByStudentIdInAndVisibilityIn(studentIds, visibilities, page);
        }
        if (excludedStudentId != null && !excludedStudentId.isBlank()) {
            return repository.findByVisibilityInAndStudentIdNot(visibilities, excludedStudentId, page);
        }
        return repository.findByVisibilityIn(visibilities, page);
    }

    public long clearCompleted(String owner) {
        return repository.deleteByStudentIdAndCompletedTrue(owner);
    }

    // Not-owned tasks look the same as missing ones so ids are not leaked
    private Task findOwned(String owner, int id) {
        return repository.findById(id)
                .filter(t -> t.getStudentId().equals(owner))
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Task not found"));
    }

    private static void apply(Task task, TaskRequest request) {
        String title = request.title() == null ? "" : request.title().trim();
        if (title.isEmpty() || title.length() > MAX_TITLE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Title is required (max " + MAX_TITLE + " characters)");
        }

        String description = request.description() == null ? null : request.description().trim();
        if (description != null && description.length() > MAX_DESCRIPTION) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Description is too long (max " + MAX_DESCRIPTION + " characters)");
        }

        String priority = request.priority() == null ? "medium" : request.priority();
        if (!PRIORITIES.contains(priority)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Priority must be low, medium or high");
        }

        task.setTitle(title);
        task.setDescription(description == null || description.isEmpty() ? null : description);
        task.setDeadline(request.deadline());
        task.setPriority(priority);
        if (request.visibility() != null) {
            if (!VISIBILITIES.contains(request.visibility())) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Visibility must be only_me, trusted or open");
            }
            task.setVisibility(request.visibility());
        }
        if (request.completed() != null) {
            task.setCompleted(request.completed());
        }
    }
}
