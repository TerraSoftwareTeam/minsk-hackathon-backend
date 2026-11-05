import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import {
  CreateEventDto,
  EventParticipantDto,
  EventResponseDto,
  ListEventsQueryDto,
  UpdateEventDto,
} from './dto/event.dto';
import { EventsService } from './events.service';

const INACTIVE = 'The event has already started and is no longer active';
const HIDDEN =
  'Event not found, or it is a school event of another school (hidden)';

@ApiTags('Events')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid bearer token' })
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a one-time event',
    description:
      'Teacher or organizator. access = SCHOOL: only pupils of one school (a teacher: their own school; an organizator passes schoolId). access = ALL: every pupil. Pupils can sign up until startsAt (Europe/Minsk if no offset is given).',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiBadRequestResponse({
    description: 'startsAt in the past, or schoolId missing',
  })
  @ApiForbiddenResponse({
    description: 'Not a teacher/organizator, or another school',
  })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateEventDto,
  ): Promise<EventResponseDto> {
    return this.events.create(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List events visible to the current user',
    description:
      'Events for everyone plus school events of the user school (an organizator sees all). Inactive events are included unless ?active=true.',
  })
  @ApiOkResponse({ type: [EventResponseDto] })
  list(
    @CurrentUser() actor: User,
    @Query() query: ListEventsQueryDto,
  ): Promise<EventResponseDto[]> {
    return this.events.list(actor, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: HIDDEN })
  findOne(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.events.findOne(actor, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit an event',
    description:
      'The author or an organizator, only while the event is active. maxParticipants: null removes the limit.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Not the author or an organizator' })
  @ApiNotFoundResponse({ description: HIDDEN })
  @ApiConflictResponse({
    description: `${INACTIVE}; or maxParticipants below the current count; or restricting to a school while pupils of other schools are signed up`,
  })
  update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<EventResponseDto> {
    return this.events.update(actor, id, dto);
  }

  @Post(':id/registration')
  @ApiOperation({
    summary: 'Sign up for an event',
    description: 'Pupils only, while the event is active and has free spots.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Not a pupil' })
  @ApiNotFoundResponse({ description: HIDDEN })
  @ApiConflictResponse({
    description: `Already signed up, no free spots, or: ${INACTIVE}`,
  })
  register(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.events.register(actor, id);
  }

  @Delete(':id/registration')
  @ApiOperation({
    summary: 'Cancel own sign-up',
    description: 'Only while the event is active.',
  })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiNotFoundResponse({ description: `Not signed up, or: ${HIDDEN}` })
  @ApiConflictResponse({ description: INACTIVE })
  unregister(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.events.unregister(actor, id);
  }

  @Get(':id/participants')
  @ApiOperation({
    summary: 'Pupils signed up for the event',
    description:
      'Any user who can see the event, signed up or not. Also available after the event.',
  })
  @ApiOkResponse({ type: [EventParticipantDto] })
  @ApiNotFoundResponse({ description: HIDDEN })
  participants(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventParticipantDto[]> {
    return this.events.participants(actor, id);
  }
}
