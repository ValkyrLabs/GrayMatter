FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml ./
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q test package

FROM eclipse-temurin:17-jre-jammy
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/graymatter-local-server-*.jar /app/graymatter-local-server.jar
RUN mkdir -p /data && chown -R 10001:10001 /app /data
USER 10001:10001
ENV SERVER_PORT=8787 \
    GRAYMATTER_DATA_DIR=/data
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=25s --retries=12 \
  CMD curl -fsS http://127.0.0.1:8787/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "/app/graymatter-local-server.jar"]
