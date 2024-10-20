import { defineEndpoint } from "@directus/extensions-sdk";
import { format, isAfter, isBefore, isEqual, parse } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { z } from "zod";

const SlotSchema = z.object({
  date: z.string(),
  time_start: z.string(),
  time_end: z.string(),
  slot_definition: z.string(),
});

export default defineEndpoint((router, context) => {
  router.patch("/", async (_req, res) => {
    // @ts-ignore
    // this ensures public or unauthenticated calls will get forbidden error
    if (!_req.accountability || !_req.accountability?.user)
      return res.status(403).send("Forbidden");

    // validate request payload
    if (!_req.body.slots || !Array.isArray(_req.body.slots))
      return res.status(400).send("Wrong data or wrong data type");

    // validate each slot payload
    const invalidSlotFound = _req.body.slots.some(
      (slot: any) => !SlotSchema.safeParse(slot).success
    );
    if (invalidSlotFound)
      return res.status(400).send("Wrong data or wrong data type");

    const schema = await context.getSchema();

    // get user
    const [user, getUserError] = await getUser(_req, context, schema);
    if (getUserError) return errorResponse(res, getUserError);

    // validate and create slots
    const slotValidationError = await validateSlots(
      context,
      schema,
      user,
      _req.body.slots
    );
    if (slotValidationError) return errorResponse(res, slotValidationError);

    // read "held" slots
    const [heldSlots, slotsReadError] = await readUserHeldSlots(
      context,
      schema,
      user
    );
    if (slotsReadError && typeof slotsReadError == "string")
      return errorResponse(res, slotsReadError);

    return res.status(200).send({ slots: heldSlots });
  });
});

const getUser = async (req: any, context: any, schema: any) => {
  const { UsersService } = context.services;
  const usersService = new UsersService({
    schema: schema,
  });

  // get user
  const [user, readError] = await tryCatcher<any>(
    usersService.readOne(req.accountability?.user, {
      fields: ["id"],
    })
  );
  if (readError) {
    context.logger.error(
      `Something went wrong while fetching user(${req.accountability?.user})`
    );
    return [null, "Internal server error while fetching user"];
  }

  return [user, ""];
};

const validateSlots = async (
  context: any,
  schema: any,
  user: any,
  slots: any[]
) => {
  const { ItemsService } = context.services;
  const slotService = new ItemsService("slots", {
    schema: schema,
  });
  const slotDefinitionService = new ItemsService("slot_definitions", {
    schema: schema,
  });
  const reservationService = new ItemsService("reservations", {
    schema: schema,
  });

  // check if all slots come from same institution
  const [slotDefinitions, slotDefinitionsReadError] = await tryCatcher<any[]>(
    slotDefinitionService.readByQuery({
      fields: ["id", "variant.service.institution"],
      filter: {
        id: {
          _in: slots.map((slot) => slot.slot_definition),
        },
      },
    })
  );
  if (slotDefinitionsReadError) {
    context.logger.error(
      `Something went wrong while reading slot_definitions: ${slotDefinitionsReadError}`
    );
    return "Internal server error while fetching slot_definitions";
  }

  // check if institution ids are same
  const uniqueInstitutionIds = new Set();
  slotDefinitions.forEach((slotDefinition) =>
    uniqueInstitutionIds.add(slotDefinition.variant?.institution)
  );
  if (uniqueInstitutionIds.size > 1)
    return "Cannot reserve slots from different institutions";

  // before adding slots, delete all previous held user slots/reservations
  const [_, slotsDeleteError] = await tryCatcher(
    slotService.deleteByQuery({
      filter: {
        _and: [
          {
            reservations: {
              user: {
                id: {
                  _eq: user.id,
                },
              },
            },
          },
          {
            reservations: {
              status: {
                _eq: "held",
              },
            },
          },
        ],
      },
    })
  );
  if (slotsDeleteError) {
    context.logger.error(
      `Something went wrong while deleting old held slots/reservations: ${slotsDeleteError}`
    );
    return "Internal server error while deleting old slots/reservations";
  }

  // validate each slot
  // if valid, create it and create a reservation with status "held"
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];

    // read extra data for this slot
    const [slotDefinition, slotDefinitionReadError] = await tryCatcher<any>(
      slotDefinitionService.readOne(slot.slot_definition, {
        fields: [
          "id",
          "capacity",
          "variant.service.id",
          "variant.service.schedule.day_definitions.day_of_week",
          "variant.service.schedule.day_definitions.time_start",
          "variant.service.schedule.day_definitions.time_end",
          "variant.service.schedule.day_definitions.capacity",
        ],
      })
    );
    if (slotDefinitionReadError) {
      context.logger.error(
        `Error while reading slot_definitions: ${slotDefinitionReadError}`
      );
      return "Internal server error while reading slot_definitions";
    } else if (
      !slotDefinition ||
      !slotDefinition.variant ||
      !slotDefinition.variant.service ||
      !slotDefinition.variant.service.schedule ||
      !slotDefinition.variant.service.schedule.day_definitions ||
      !slotDefinition.variant.service.schedule.day_definitions.length
    ) {
      continue;
      // return `No slot definition for slot: ${slot.slot_definition}`;
    }

    // find matching day_definition
    const matchingDayDefinition =
      slotDefinition.variant.service.schedule.day_definitions.find(
        (dayDefinition: any) =>
          format(
            toZonedTime(slot.date, "Europe/Ljubljana"),
            "EEEE"
          ).toLowerCase() === dayDefinition.day_of_week
      );
    if (!matchingDayDefinition) continue;

    // make sure slot's time start/end matches dayDefinition's time start/end
    const firstTimeStartDate = timeToDate(slot.time_start);
    const firstTimeEndDate = timeToDate(slot.time_end);
    const secondTimeStartDate = timeToDate(matchingDayDefinition.time_start);
    const secondTimeEndDate = timeToDate(matchingDayDefinition.time_end);
    const timingsDoQualify =
      (isBefore(firstTimeStartDate, secondTimeEndDate) ||
        isEqual(firstTimeStartDate, secondTimeEndDate)) &&
      (isAfter(firstTimeEndDate, secondTimeStartDate) ||
        isEqual(firstTimeEndDate, secondTimeStartDate));
    if (!timingsDoQualify) continue;

    // get slots that intersect with this slot
    const [intersectingSlots, slotReadError] = await tryCatcher<any[]>(
      slotService.readByQuery({
        fields: [
          "id",
          "time_start",
          "time_end",
          "slot_definition.id",
          "slot_definition.duration",
          "slot_definition.capacity",
          "reservations.user.id",
        ],
        filter: {
          date: {
            _eq: slot.date,
          },
          slot_definition: {
            variant: {
              service: {
                id: {
                  _eq: slotDefinition.variant?.service?.id,
                },
              },
            },
          },
          // filter intersecting slots
          _or: [
            {
              _and: [
                {
                  time_start: {
                    _gt: slot.time_start,
                  },
                },
                {
                  time_start: {
                    _lt: slot.time_end,
                  },
                },
              ],
            },
            {
              _and: [
                {
                  time_start: {
                    _gte: slot.time_start,
                  },
                },
                {
                  time_start: {
                    _lt: slot.time_end,
                  },
                },
                {
                  time_end: {
                    _gt: slot.time_start,
                  },
                },
                {
                  time_end: {
                    _gte: slot.time_end,
                  },
                },
              ],
            },
            {
              _and: [
                {
                  time_end: {
                    _gt: slot.time_start,
                  },
                },
                {
                  time_end: {
                    _lt: slot.time_end,
                  },
                },
              ],
            },
          ],
        },
      })
    );
    if (slotReadError) {
      context.logger.error(
        `Error while reading intersecting slots: ${slotReadError}`
      );
      return "Internal server error while reading slots";
    }

    if (intersectingSlots?.length) {
      // check if adding this slot would excess schedule dayDefinition specified capacity
      let capacitySum = intersectingSlots.length;
      if (capacitySum + 1 > matchingDayDefinition.capacity) {
        continue;
        // return "Cannot add the slot, it exceeded schedule capacity";
      }

      // check if adding this slot would excess slot_definition specified capacity
      let slotDefinitionCapacitySum = intersectingSlots.reduce(
        (sum, intersectingSlot) =>
          sum + intersectingSlot.slot_definition == slotDefinition.id,
        0
      );
      if (slotDefinitionCapacitySum + 1 > slotDefinition.capacity) {
        continue;
        // return "Cannot add the slot, it exceeded slot definition capacity";
      }

      // check if intersecting slot is reserved by this user
      const isReservedByActiveUser = intersectingSlots.some(
        (intersectingSlot) =>
          intersectingSlot.reservations.some(
            (reservation: any) => reservation.user.id == user.id
          )
      );
      if (isReservedByActiveUser) {
        continue;
      }
    }

    // create the slot
    const [createdSlotId, slotCreateError] = await tryCatcher(
      slotService.createOne({
        date: slot.date,
        time_start: slot.time_start,
        time_end: slot.time_end,
        slot_definition: slotDefinition.id,
        schedule: slotDefinition.variant.service.schedule.id,
      })
    );
    if (slotCreateError) {
      context.logger.error(
        `Error while creating slot ${slot.date} (${slot.time_start} - ${slot.time_end}): ${slotCreateError}`
      );
      return "Internal server error while creating slot";
    }

    // create reservation
    const [_, reservationCreateError] = await tryCatcher(
      reservationService.createOne({
        user: user.id,
        slot: createdSlotId,
        status: "held",
      })
    );
    if (slotReadError) {
      context.logger.error(
        `Error while creating reservation: ${reservationCreateError}`
      );
      return "Internal server error while creating reservation";
    }
  }

  return null;
};

const readUserHeldSlots = async (context: any, schema: any, user: any) => {
  const { ItemsService } = context.services;
  const slotService = new ItemsService("slots", {
    schema: schema,
  });

  const [slots, slotsReadError] = await tryCatcher<any[]>(
    slotService.readByQuery({
      fields: [
        "*",
        "slot_definition.*",
        "slot_definition.variant.*",
        "slot_definition.variant.service.*",
        "reservations.*",
        // "id",
        // "date",
        // "time_start",
        // "time_end",
        // "slot_definition.id",
        // "slot_definition.price",
        // "slot_definition.variant.id",
        // "slot_definition.variant.service.id",
        // "reservations.user.id",
        // "reservations.slot.date",
        // "reservations.slot.time_start",
        // "reservations.slot.time_end",
        // "reservations.slot.slot_definition.id",
        // "reservations.slot.slot_definition.variant.id",
        // "reservations.slot.slot_definition.variant.service.id",
      ],
      filter: {
        _and: [
          {
            reservations: {
              user: {
                id: {
                  _eq: user.id,
                },
              },
            },
          },
          {
            reservations: {
              status: {
                _eq: "held",
              },
            },
          },
        ],
      },
    })
  );
  if (slotsReadError) {
    context.logger.error(
      `Error while reading user held slots: ${slotsReadError}`
    );
    return [null, "Internal server error while reading user held slots"];
  }

  return [slots, null];
};

const timeToDate = (time: string) => {
  const referenceDate = new Date(); // Any valid date
  const timeDate = parse(time, "HH:mm:ss", referenceDate);
  return timeDate;
};

async function tryCatcher<T, E = Error>(
  promise: Promise<T>
): Promise<[T, null] | [null, E]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}

const errorResponse = (res: any, message: string, code: number = 500) => {
  return res.status(code).send(message);
};
