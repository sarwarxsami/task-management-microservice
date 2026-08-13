sudo docker rm -f postgres-db && sudo docker container prune -f && sudo docker run -d \
  --name postgres-db \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=postgresdb \
  -p 5432:5432 \
  -v /home/sami-sarwar/Documents/DevOps/task-management-microservice/db/init.sql:/docker-entrypoint-initdb.d/init.sql \
  postgres:latest
