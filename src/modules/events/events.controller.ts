import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ApiUuidParam } from '../../common/swagger/api-uuid-param.decorator';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '../images/images.constants';
import { ValidateImageFilePipe } from '../images/pipes/validate-image-file.pipe';
import { CreateEventDto } from './dto/create-event.dto';
import { DeclineEventDto } from './dto/decline-event.dto';
import { EventResponseDto } from './dto/event-response.dto';
import { EventLikeResponseDto } from './dto/event-like-response.dto';
import { EventVoteResponseDto } from './dto/event-vote-response.dto';
import { ProbabilityQueryDto } from './dto/probability-query.dto';
import { ProbabilityResponseDto } from './dto/probability-response.dto';
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
    summary: 'Create an event',
    description:
      "Any role; the role picks the flow (createdByRole in the response).\n\n" +
      "PUPIL: status ON_MODERATION, moderated by every teacher of the pupil's class (they all get a push). " +
      'Then ON_VOTE -> ON_ADMIN_MODERATION -> FINALIZED.\n\n' +
      'TEACHER (school event): no teacher moderation, status ON_VOTE at once; scope relative to the teacher\'s class. ' +
      'Then ON_ADMIN_MODERATION, where the admin approves or declines.\n\n' +
      'ADMIN (school event): no moderation, scope SCHOOL. Status ON_VOTE, then FINALIZED (no admin moderation).\n\n' +
      'Every role: startsAt is required (in the future) and nobody can change it afterwards: moderators only approve or decline. ' +
      'Voting (ON_VOTE) gathers participants until maxParticipants joined (optional; the event moves on at once) ' +
      'or until votingClosesAt (3 days before startsAt): then with at least voteThreshold votes it moves on, otherwise EXPIRED. ' +
      'Teacher moderation also ends at votingClosesAt, admin moderation at startsAt; not decided by then -> EXPIRED.',
  })
  @ApiBody({ type: CreateEventDto })
  @ApiCreatedResponse({ type: EventResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed (incl. an unknown field); startsAt missing or not in the future; maxParticipants below voteThreshold; ' +
      'admin: scope other than SCHOOL; pupil or teacher without a class',
  })
  @ApiConflictResponse({ description: 'Event with this name already exists' })
  create(
    @CurrentUser() actor: User,
    @Body() dto: CreateEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.create(actor, dto);
  }

  @Get('probability')
  @ApiOperation({
    summary: 'Preview the probability that an event takes place',
    description:
      'Any authenticated user. Computed from FINALIZED events of the same category (the only ones with a date set by an admin), ' +
      'even if they have not started yet. With startsAt only the start time of day (Minsk time) is compared, not the date; ' +
      'without it every such event counts fully. At least 5 such events (at the same time): 0.9; no history: 0.5.',
  })
  @ApiOkResponse({ type: ProbabilityResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid category, or startsAt is given but is not a date-time with a timezone',
  })
  async previewProbability(
    @Query() query: ProbabilityQueryDto,
  ): Promise<ProbabilityResponseDto> {
    return {
      successProbability: await this.eventsService.previewProbability(
        query.category,
        query.startsAt ? new Date(query.startsAt) : null,
      ),
    };
  }

  @Get('moderation')
  @ApiOperation({
    summary: "Teacher's moderation list",
    description:
      "Teacher only. Events of pupils of the caller's class with status ON_MODERATION, oldest first. Events past their deadline (3 days before startsAt) are hidden.",
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
      'Any role. All events created by the caller, in any status, newest first, with the vote count.',
  })
  @ApiOkResponse({ type: [VotingEventResponseDto] })
  findMine(@CurrentUser() actor: User): Promise<VotingEventResponseDto[]> {
    return this.eventsService.findMine(actor);
  }

  @Get('voting')
  @ApiOperation({
    summary: "Pupil's voting list",
    description:
      "Pupil only. ON_VOTE events whose scope includes the caller (relative to the initiator's class: CLASS - same class, GRADE - same grade, SCHOOL - any pupil) and whose voting is still open, newest first, with the vote count and whether the caller has voted.",
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
      'Admin only. Events with status ON_ADMIN_MODERATION (passed the vote), oldest first. ' +
      'Events that have already started (deadline = startsAt) are hidden.',
  })
  @ApiOkResponse({ type: [EventResponseDto] })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  findForAdminModeration(
    @CurrentUser() actor: User,
  ): Promise<EventResponseDto[]> {
    return this.eventsService.findForAdminModeration(actor);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an event with all its data',
    description: "Initiator, any teacher of the initiator's class, or admin.",
  })
  @ApiUuidParam()
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
    description: "Any teacher of the author's class. ON_MODERATION -> ON_VOTE. The first decision wins.",
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: "Caller is not a teacher of the author's class" })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description:
      'Event is not on moderation anymore, or its deadline (3 days before startsAt) has passed',
  })
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
    description:
      "Any teacher of the author's class. ON_MODERATION -> DECLINED, with an optional reason. The first decision wins.",
  })
  @ApiUuidParam('reason is empty or longer than 2000 characters')
  @ApiBody({ type: DeclineEventDto, required: false })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: "Caller is not a teacher of the author's class" })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description:
      'Event is not on moderation anymore, or its deadline (3 days before startsAt) has passed',
  })
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
    description:
      'Admin only. ON_ADMIN_MODERATION -> FINALIZED. No body: the date was chosen by the author and cannot be changed.',
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description:
      'Event is not on admin moderation, or it has already started (startsAt has passed)',
  })
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
    description:
      'Admin only. ON_ADMIN_MODERATION -> DECLINED_BY_ADMIN, with an optional reason.',
  })
  @ApiUuidParam('reason is empty or longer than 2000 characters')
  @ApiBody({ type: DeclineEventDto, required: false })
  @ApiOkResponse({ type: EventResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description:
      'Event is not on admin moderation, or it has already started (startsAt has passed)',
  })
  adminDecline(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineEventDto,
  ): Promise<EventResponseDto> {
    return this.eventsService.adminDecline(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an event',
    description:
      "Deletes the event for good, with its votes, likes and image. The author, or a teacher of the pupil author's class: only while the event is pending (ON_MODERATION, ON_VOTE, ON_ADMIN_MODERATION) and not past its deadline. An admin: any event in any status. When a teacher or an admin deletes it, the author gets an EVENT_DELETED push.",
  })
  @ApiUuidParam()
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiForbiddenResponse({
    description: "Caller is not the author, a teacher of the pupil author's class or an admin",
  })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description: 'Author or teacher: the event is already decided (or past its deadline)',
  })
  remove(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.eventsService.remove(actor, id);
  }

  @Put(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
    }),
  )
  @ApiOperation({
    summary: 'Set or replace the event image',
    description:
      'Author only, while the event is pending (ON_MODERATION, ON_VOTE, ON_ADMIN_MODERATION) and not past its deadline. ' +
      `An event has at most one image: a new upload replaces and deletes the previous one. multipart/form-data, field "file": ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}, up to 5 MB; the type is checked by the file content.`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG, PNG, WebP or GIF, up to 5 MB',
        },
      },
    },
  })
  @ApiUuidParam('the file is missing, or is not a JPEG/PNG/WebP/GIF image')
  @ApiOkResponse({
    type: EventResponseDto,
    description: 'The event with its new imageUrl',
  })
  @ApiForbiddenResponse({ description: 'Caller is not the author' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description: 'The event is already decided (or past its deadline)',
  })
  @ApiPayloadTooLargeResponse({ description: 'File is larger than 5 MB' })
  @ApiBadGatewayResponse({
    description: 'The image storage (Cloudinary) rejected the upload',
  })
  setImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(ValidateImageFilePipe) file: Express.Multer.File,
  ): Promise<EventResponseDto> {
    return this.eventsService.setImage(actor, id, file);
  }

  @Delete(':id/image')
  @ApiOperation({
    summary: 'Remove the event image',
    description:
      'Author while the event is pending and not past its deadline; an admin in any status. Does nothing if the event has no image.',
  })
  @ApiUuidParam()
  @ApiOkResponse({
    type: EventResponseDto,
    description: 'The event, imageUrl is null',
  })
  @ApiForbiddenResponse({
    description: 'Caller is neither the author nor an admin',
  })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description: 'Author: the event is already decided (or past its deadline)',
  })
  removeImage(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventResponseDto> {
    return this.eventsService.removeImage(actor, id);
  }

  @Post(':id/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vote for an event',
    description:
      "Pupil only. The event must be ON_VOTE and voting must be open (until votingClosesAt: 3 days before startsAt). One vote per pupil per event, the pupil organizer's included (cast on creation). Audience by scope, relative to the initiator's class: CLASS - same class, GRADE - same grade (first number of the class name), SCHOOL - any pupil. Voting stays open past voteThreshold: only the vote that reaches maxParticipants moves the event on at once (to ON_ADMIN_MODERATION, an admin event to FINALIZED); without it the event moves on (or expires) when voting closes.",
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventVoteResponseDto })
  @ApiForbiddenResponse({
    description: "Caller is not a pupil, or is outside the event's scope",
  })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description:
      'Event is not on vote (also: it is full, maxParticipants reached), voting has closed (votingClosesAt has passed), or the pupil has already voted',
  })
  vote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventVoteResponseDto> {
    return this.eventsService.vote(actor, id);
  }

  @Delete(':id/vote')
  @ApiOperation({
    summary: 'Take the vote back (unsubscribe from the event)',
    description:
      'Pupil only, and only the pupil who voted. The event must still be ON_VOTE and voting must be open ' +
      '(until votingClosesAt): once voting has closed and the event moved on (ON_ADMIN_MODERATION or FINALIZED), ' +
      'its votes stay. The pupil can vote again afterwards.',
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventVoteResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({
    description: 'Event is not on vote, voting has closed, or the pupil has not voted for it',
  })
  unvote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventVoteResponseDto> {
    return this.eventsService.unvote(actor, id);
  }

  @Put(':id/like')
  @ApiOperation({
    summary: 'Like an event (+1)',
    description:
      'Pupil only, any pupil: the event scope does not limit who likes. ' +
      'The event must be approved by the teacher: ON_VOTE, ON_ADMIN_MODERATION, FINALIZED or DECLINED_BY_ADMIN. ' +
      'One like per pupil per event: liking again changes nothing.',
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventLikeResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  @ApiConflictResponse({ description: 'Event is ON_MODERATION, DECLINED or EXPIRED' })
  like(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventLikeResponseDto> {
    return this.eventsService.like(actor, id);
  }

  @Delete(':id/like')
  @ApiOperation({
    summary: 'Take the like back (-1)',
    description:
      'Pupil only, in any status of the event. Does nothing if the caller has not liked it.',
  })
  @ApiUuidParam()
  @ApiOkResponse({ type: EventLikeResponseDto })
  @ApiForbiddenResponse({ description: 'Caller is not a pupil' })
  @ApiNotFoundResponse({ description: 'Event not found' })
  unlike(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EventLikeResponseDto> {
    return this.eventsService.unlike(actor, id);
  }
}
