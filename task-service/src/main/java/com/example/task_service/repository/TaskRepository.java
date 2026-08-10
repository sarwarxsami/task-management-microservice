package com.example.task_service.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.example.task_service.model.Task;


public interface TaskRepository extends JpaRepository<Task, Integer> {

}