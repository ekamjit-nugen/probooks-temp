Feature: Network isolates the data tier (STANDARDS §18)
  The VPC keeps the data tier (RDS, Redis) off the public internet. Private
  application subnets reach out via NAT; isolated subnets hold the databases
  with no egress. VPC flow logs capture traffic for forensic audit.

  Scenario: The VPC spans isolated subnets for the data tier
    Given the network stack
    When I inspect the VPC subnets
    Then there is at least one PRIVATE_ISOLATED subnet group for the data tier
    And there is a PRIVATE_WITH_EGRESS subnet group for the application tier

  Scenario: NAT provides controlled egress for private subnets
    Given the network stack
    When I inspect the VPC
    Then a NAT gateway exists for private-with-egress subnets

  Scenario: VPC flow logs are enabled
    Given the network stack
    When I inspect the VPC
    Then a flow log is attached to the VPC
    And its traffic type captures ALL traffic
