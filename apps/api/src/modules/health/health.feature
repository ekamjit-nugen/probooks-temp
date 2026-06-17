Feature: Health endpoints (STANDARDS §14 ops; liveness + readiness)
  The platform exposes unauthenticated infrastructure endpoints so load
  balancers and orchestrators (ECS/ALB) can route traffic only to healthy
  instances. Liveness answers "is the process up?"; readiness answers "can it
  serve requests?" — which requires its critical dependency (Postgres) to be
  reachable on BOTH the app_user and service_role connections.

  Scenario: Liveness is up whenever the process can answer
    Given the API process is running
    When I GET /health/live
    Then the response is 200 with status "ok"
    And it does not touch the database (cheap, dependency-free)

  Scenario: Readiness is ok when every dependency check passes
    Given Postgres answers on both the app_user and service_role connections
    When I GET /health/ready
    Then the response is 200 with status "ok"
    And each dependency check reports "up"

  Scenario: Readiness is 503 when a dependency check fails
    Given the app_user database connection is unreachable
    When I GET /health/ready
    Then the response is 503 SERVICE_NOT_READY
    And the failing check reports "down" in the details

  Scenario: Health endpoints are NOT behind the guard stack (no auth required)
    Given no Authorization header is present
    When I GET /health/live or /health/ready
    Then the request is not rejected with 401/403 (the routes are unguarded)

  Scenario: The database indicator reports up on a successful ping
    Given a database client whose SELECT 1 resolves
    When the indicator checks it
    Then it returns { name, status: "up" }

  Scenario: The database indicator reports down on a failed ping
    Given a database client whose SELECT 1 rejects
    When the indicator checks it
    Then it returns { name, status: "down" } and never throws
