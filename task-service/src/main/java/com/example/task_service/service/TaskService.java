package com.example.task_service.service;

import java.util.List;
import java.util.Set;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.example.task_service.dto.TaskRequest;
import com.example.task_service.exception.ApiException;
import com.example.task_service.model.Task;
import com.example.task_service.repository.TaskRepository;

@Service
public class TaskService {

    public record Caller(String studentId, boolean admin) {
    }

    private static final Set<String> PRIORITIES = Set.of("low", "medium", "high");
    public static final Set<String> VISIBILITIES = Set.of("only_me", "trusted", "open");
    private static final int MAX_TITLE = 200;
    private static final int MAX_DESCRIPTION = 2000;

    private final TaskRepository repository;

    public TaskService(TaskRepository repository) {
        this.repository = repository;
    }

    // Users only see their own tasks; admins see everyone's, optionally filtered by studentId
    public List<Task> getTasks(Caller caller, String studentId) {
        if (!caller.admin()) {
            if (studentId != null && !studentId.equals(caller.studentId())) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
            }
            return repository.findByStudentIdOrderByCreatedAtDescIdDesc(caller.studentId());
        }
        if (studentId == null || studentId.isBlank()) {
            return repository.findAllByOrderByCreatedAtDescIdDesc();
        }
        return repository.findByStudentIdOrderByCreatedAtDescIdDesc(studentId);
    }

    public Task addTask(Caller caller, TaskRequest request) {
        String owner = caller.studentId();
        if (request.studentId() != null && !request.studentId().equals(owner)) {
            if (!caller.admin()) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
            }
            owner = request.studentId();
        }

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

    public Task updateTask(Caller caller, int id, TaskRequest request) {
        Task task = findOwned(caller, id);
        apply(task, request);
        return repository.save(task);
    }

    public Task setStatus(Caller caller, int id, boolean completed) {
        Task task = findOwned(caller, id);
        task.setCompleted(completed);
        return repository.save(task);
    }

    public void deleteTask(Caller caller, int id) {
        repository.delete(findOwned(caller, id));
    }

    // Used by social-service, which decides who may see what
    public List<Task> findForSharing(List<String> studentIds, List<String> visibilities) {
        if (visibilities.isEmpty() || !VISIBILITIES.containsAll(visibilities)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid visibilities");
        }
        if (studentIds.isEmpty()) {
            return repository.findByVisibilityInOrderByCreatedAtDescIdDesc(visibilities);
        }
        return repository.findByStudentIdInAndVisibilityInOrderByCreatedAtDescIdDesc(studentIds, visibilities);
    }

    public long clearCompleted(Caller caller) {
        return repository.deleteByStudentIdAndCompletedTrue(caller.studentId());
    }

    // Not-owned tasks look the same as missing ones so ids are not leaked
    private Task findOwned(Caller caller, int id) {
        return repository.findById(id)
                .filter(t -> caller.admin() || t.getStudentId().equals(caller.studentId()))
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
