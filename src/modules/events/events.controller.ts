import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CreateEventDto } from './dto/create-event.dto';
import { DeclineEventDto } from './dto/decline-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventsService } from './events.service';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an event request',
    description:
      "Pupil only. The event gets status ON_MODERATION and is sent to the teacher of the pupil's class.",
  })
  @ApiBody({ type: CreateEventDto })
  @ApiCreatedResponse({ type: EventResponseDto })
  @ApiBadRequestResponse({ description: "Validation failed, or the pupil's class has no teacher" })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  @ApiConflictResponse({ description: 'Event with this name already exists' })
  create(@CurrentUser() actor: User, @Body() dto: CreateEventDto): Promise<EventResponseDto> {
    return this.eventsService.create(actor, dto);
  }

  // Declared before ':id' so "moderation" is not parsed as an id.
  @Get('moderation')
  @ApiOperation({
    summary: "Teacher's moderation list",
    description: 'Teacher only. Events assigned to the caller with status ON_MODERATION, oldest first.',
  })
  @ApiOkResponse({ type: [EventResponseDto] })
  @ApiForbiddenResponse({ description: 'Caller is not a teacher' })
  findForModeration(@CurrentUser() actor: User): Promise<EventResponseDto[]> {
    return this.eventsService.findForModeration(actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an event with all its data',
    description: 'Initiator, assigned teacher or admin.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller may not read this event' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.eventsService.findOne(actor, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve an event',
    description: 'Assigned teacher only. ON_MODERATION -> ON_VOTE.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not the assigned teacher' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is not on moderation anymore' })
  approve(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.eventsService.approve(actor, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline an event',
    description: 'Assigned teacher only. ON_MODERATION -> DECLINED, with an optional reason.',
  })
  @ApiBody({ type: DeclineEventDto, required: false })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not the assigned teacher' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is not on moderation anymore' })
  decline(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.decline(actor, id, dto);
  }
}
