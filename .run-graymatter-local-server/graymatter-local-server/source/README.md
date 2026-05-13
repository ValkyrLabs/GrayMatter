# GrayMatter Local Server

GrayMatter Local Server is a downloadable, executable starter for private agent memory.

It runs a minimum Spring Boot server on your machine with:

- RBAC-backed login through Spring Security
- `Principal` identity records
- `UserPreferences` for local user state
- `MemoryEntry` create/query APIs
- Data Workbooks through the `/Workbook` API
- an embedded Valkyr Labs-branded dashboard at `http://localhost:8787`
- a Mothership promotion bridge at `/api/graymatter/sync/*`
- a local GrayMatter SWARM v0.1 light-node adapter at `/api/graymatter/swarm/protocol`
- a ValkyrAI app-factory `application-bundle` with ThorAPI FEBE inputs
- H2 file storage in `./data`
- a Maven native profile for GraalVM/Spring Native builds

## Run

```bash
bin/graymatter-local-server
```

Default credentials:

- username: `admin`
- password: `graymatter-local`

Override before launch:

```bash
export GRAYMATTER_ADMIN_USERNAME=admin
export GRAYMATTER_ADMIN_PASSWORD='replace-me'
bin/graymatter-local-server
```

## Build from source

```bash
cd source
./mvnw package
```

If the archive includes `lib/graymatter-local-server.jar`, the launcher runs it directly.
Otherwise it builds from `source` with local Maven or the Maven wrapper.

## Promote / Synchronize

The dashboard button calls `POST /api/graymatter/sync/mothership`.
This prepares a promotion payload and reports the local bundle, memory, workbook,
and Swarm Protocol state. It does not claim hosted synchronization completed
unless the operator supplies hosted auth such as `VALKYR_AUTH_TOKEN`.

Swarm Protocol status is exposed locally at:

```bash
curl -u admin:graymatter-local http://localhost:8787/api/graymatter/swarm/protocol
```

## Native build

With GraalVM native-image installed:

```bash
cd source
./mvnw -Pnative native:compile
```
