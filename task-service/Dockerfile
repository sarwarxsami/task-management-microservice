FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

RUN apk add --no-cache maven

COPY ./pom.xml /app/pom.xml

COPY ./src/ /app/src/

RUN mvn clean install -DskipTests


FROM eclipse-temurin:21-jre-alpine AS runtime

WORKDIR /task-service

COPY --from=builder ./app/target/task-service-0.0.1-SNAPSHOT.jar task-service.jar

CMD [ "java", "-jar", "./task-service.jar" ]