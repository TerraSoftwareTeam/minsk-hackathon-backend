import { applyDecorators } from '@nestjs/common';
import { ApiBadRequestResponse, ApiParam } from '@nestjs/swagger';

/**
 * Documents a `:id` path param validated by ParseUUIDPipe, including its 400.
 * Pass `otherBadRequest` when the route has more 400 causes (e.g. body validation):
 * a route can document only one 400 response.
 */
export function ApiUuidParam(otherBadRequest?: string): MethodDecorator {
  const invalidId = 'Invalid id: must be a UUID';
  return applyDecorators(
    ApiParam({ name: 'id', format: 'uuid', example: '3f2c9a4e-1b7d-4e8a-9c0f-2a6b5d7e8f90' }),
    ApiBadRequestResponse({
      description: otherBadRequest ? `${invalidId}, or ${otherBadRequest}` : invalidId,
    }),
  );
}
