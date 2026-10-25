FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

RUN apk add --no-cache maven

COPY ./pom.xml /app/pom.xml

RUN mvn -B dependency:go-offline

COPY ./src/ /app/src/

RUN mvn -B clean package -DskipTests


FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S app && adduser -S app -G app

WORKDIR /task-service

COPY --from=builder /app/target/task-service-0.0.1-SNAPSHOT.jar task-service.jar

USER app

CMD [ "java", "-jar", "./task-service.jar" ]
