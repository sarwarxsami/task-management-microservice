FROM eclipse-temurin:21-jdk-alpine AS builder

WORKDIR /app

RUN apk add --no-cache maven

COPY ./pom.xml /app/pom.xml

RUN mvn -B dependency:go-offline

COPY ./src/ /app/src/

RUN mvn -B clean package -DskipTests


FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S app && adduser -S app -G app

WORKDIR /social-service

COPY --from=builder /app/target/social-service-0.0.1-SNAPSHOT.jar social-service.jar

USER app

# Small fixed footprint so several JVMs fit on a small VM
ENV JAVA_TOOL_OPTIONS="-Xms64m -Xmx192m -Xss512k -XX:MaxMetaspaceSize=160m -XX:ReservedCodeCacheSize=64m -XX:+UseSerialGC -XX:TieredStopAtLevel=1"

CMD [ "java", "-jar", "./social-service.jar" ]
