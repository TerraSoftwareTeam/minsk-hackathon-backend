import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: true, description: 'Health check status' })
  ok!: boolean;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({
    description: 'Service is healthy',
    type: HealthResponseDto,
  })
  healthcheck(): HealthResponseDto {
    return { ok: true };
  }
}

