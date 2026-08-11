user-service is creating user, showing user detail and input tasks, it will be written in javascript

task-service is showing the tasks of specific user, it will be written in spring-boot

only one database instance will be used for both services for this project

-----------

Base URL:
/service

------------

user-service er api:

POST /user-service/add/user
Request Body:
{
    "name": "Sami Sarwar",
    "studentId": "12345"
}

POST /user-service/add/task
Request Body:
{
    "studentId": "12345",
    "task": "Learn Docker"
}

GET /user-service/show/user
Response:
{
    "name": "Sami Sarwar",
    "studentId": "12345"
}

----------------

task-service er API

GET /task-service/show/task
Response:
{
    "name": "Sami Sarwar",
    "studentId": "12345",
    "tasks": [
        "Learn Docker",
        "Learn Microservices",
        "Deploy on AWS"
    ]
}
