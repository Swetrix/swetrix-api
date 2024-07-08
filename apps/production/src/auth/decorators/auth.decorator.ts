import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common'
import {
  ApiKeyRateLimitGuard,
  JwtAccessTokenGuard,
  MultiAuthGuard,
  RolesGuard,
} from '../guards'
import { UserType } from '../../user/entities/user.entity'
import { ROLES_KEY } from './roles.decorator'

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth'
export function Auth(
  roles?: UserType[],
  isApiKeyAuth = false,
  isOptionalAuth = false,
) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    SetMetadata(IS_OPTIONAL_AUTH_KEY, isOptionalAuth),
    isApiKeyAuth
      ? UseGuards(MultiAuthGuard, ApiKeyRateLimitGuard, RolesGuard)
      : UseGuards(JwtAccessTokenGuard, RolesGuard),
  )
}
