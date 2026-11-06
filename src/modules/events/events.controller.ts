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
import { EventVoteResponseDto } from './dto/event-vote-response.dto';
import { VotingEventResponseDto } from './dto/voting-event-response.dto';
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

  // Declared before ':id' so "my", "voting", "moderation" and "admin-moderation" are not parsed as an id.
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

  @Get('my')
  @ApiOperation({
    summary: "Author's own events",
    description:
      'Pupil only. All events created by the caller, in any status, newest first, with the vote count.',
  })
  @ApiOkResponse({ type: [VotingEventResponseDto] })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  findMine(@CurrentUser() actor: User): Promise<VotingEventResponseDto[]> {
    return this.eventsService.findMine(actor);
  }

  @Get('voting')
  @ApiOperation({
    summary: "Pupil's voting list",
    description:
      "Pupil only. ON_VOTE events whose scope includes the caller (relative to the initiator's class: CLASS - same class, GRADE - same grade, SCHOOL - any pupil), newest first, with the vote count and whether the caller has voted.",
  })
  @ApiOkResponse({ type: [VotingEventResponseDto] })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  findForVoting(@CurrentUser() actor: User): Promise<VotingEventResponseDto[]> {
    return this.eventsService.findForVoting(actor);
  }

  @Get('admin-moderation')
  @ApiOperation({
    summary: "Admin's moderation list",
    description:
      'Admin only. Events with status ON_ADMIN_MODERATION (passed the vote), oldest first.',
  })
  @ApiOkResponse({ type: [EventResponseDto] })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  findForAdminModeration(@CurrentUser() actor: User): Promise<EventResponseDto[]> {
    return this.eventsService.findForAdminModeration(actor);
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

  @Post(':id/admin/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin approves an event',
    description: 'Admin only. ON_ADMIN_MODERATION -> FINALIZED.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is not on admin moderation' })
  adminApprove(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.eventsService.adminApprove(actor, id);
  }

  @Post(':id/admin/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin declines an event',
    description: 'Admin only. ON_ADMIN_MODERATION -> DECLINED_BY_ADMIN, with an optional reason.',
  })
  @ApiBody({ type: DeclineEventDto, required: false })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is not on admin moderation' })
  adminDecline(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.adminDecline(actor, id, dto);
  }

  @Post(':id/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vote for an event',
    description:
      "Pupil only. The event must be ON_VOTE. One vote per pupil per event. Audience by scope, relative to the initiator's class: CLASS - same class, GRADE - same grade (first number of the class name), SCHOOL - any pupil.",
  })
  @ApiOkResponse({ type: EventVoteResponseDto })
  @ApiForbiddenResponse({ description: "Caller is not a pupil, or is outside the event's scope" })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is not on vote, or the pupil has already voted' })
  vote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventVoteResponseDto> {
    return this.eventsService.vote(actor, id);
  }
}
