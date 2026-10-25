package com.example.task_service.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import com.example.task_service.model.Task;


public interface TaskRepository extends JpaRepository<Task, Integer> {

    List<Task> findAllByOrderByCreatedAtDescIdDesc();

    List<Task> findByStudentIdOrderByCreatedAtDescIdDesc(String studentId);

    @Transactional
    long deleteByStudentIdAndCompletedTrue(String studentId);
}
