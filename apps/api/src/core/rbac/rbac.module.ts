/**
 * RbacModule (STANDARDS §10.2, §10.4). Provides the RoleGuard (deny-by-default
 * role/permission authorization, re-derived per request from the §4.17 matrix in
 * @probooks/shared). Global so the guard can be applied on any controller.
 */
import { Global, Module } from "@nestjs/common";

import { RoleGuard } from "./role.guard";

@Global()
@Module({
  providers: [RoleGuard],
  exports: [RoleGuard],
})
export class RbacModule {}
