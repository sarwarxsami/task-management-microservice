package com.example.task_service.service;

import java.util.List;

import org.springframework.stereotype.Service;

import com.example.task_service.model.Task;
import com.example.task_service.repository.TaskRepository;

@Service
public class TaskService {

    private final TaskRepository repository;

    public TaskService(TaskRepository repository) {
        this.repository = repository;
    }

    public List<Task> getTasks() {
        return repository.findAll();
    }

    public Task addTask(String studentId, String task) {
        return repository.save(new Task(studentId, task));
    }

}
