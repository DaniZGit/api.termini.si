import { defineOperationApi } from "@directus/extensions-sdk";

type TriggerData = {
  date_from: string;
  date_to: string;
  collection: string;
  keys: Array<string>;
};

export default defineOperationApi({
  id: "operation-create-dates-and-slots",
  handler: async (options, context) => {
    if (!context.data["$trigger"] || !context.data["$trigger"].body) return;

    const logger = context.logger;
    const schema = await context.getSchema();
    const triggerData = context.data["$trigger"].body as TriggerData;

    for (let i = 0; i < triggerData.keys.length; i++) {
      const serviceID = triggerData.keys[i];
      const service = await fetchService(context, schema, serviceID);
      if (!service) continue;

      switch (service.type) {
        case "sports":
          handleTypeSports(context, schema, triggerData, service);
          break;
        case "hairdressing":
          handleTypeHairdressing(context, schema, triggerData, service);
          break;
        case "wellness":
          handleTypeWellness(context, schema, triggerData, service);
          break;
        case "fitness":
          break;
        case "courses":
          break;
        case "healthcare":
          break;
        case "beauty":
          break;
        default:
          logger.info(`This type of service is not handled: ${service.type}`);
          break;
      }
    }
  },
});

const fetchService = async (context: any, schema: any, serviceID: any) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const servicesService = new ItemsService("services", {
    schema: schema,
    accountability: context.accountability,
  });

  const [service, error] = await tryCatcher<any>(
    servicesService.readOne(serviceID)
  );
  if (error) {
    logger.error(`Something went wrong while reading a service: ${error}`);
    return null;
  }

  return service;
};

const createDatesAndSlots = async (
  context: any,
  schema: any,
  triggerData: TriggerData,
  schedule: any
) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const datesService = new ItemsService("dates", {
    schema: schema,
    accountability: context.accountability,
  });
  const slotsService = new ItemsService("slots", {
    schema: schema,
    accountability: context.accountability,
  });

  let dateFrom = new Date(triggerData.date_from);
  let dateTo = new Date(triggerData.date_to);

  // make sure date_start is not less than today
  if (new Date().getTime() > dateFrom.getTime()) dateFrom = new Date();

  // check if dateFrom is less than dateTo
  if (dateFrom.getTime() > dateTo.getTime()) dateTo = dateFrom;

  // get days between dateFrom and dateTo
  const days = getDaysBetweenDates(dateFrom, dateTo);

  for (let i = 0; i <= days; i++) {
    const tmpDate = new Date(dateFrom);
    tmpDate.setDate(tmpDate.getDate() + i);
    const formattedTmpDate = getFormattedDate(tmpDate); // to yyyy-mm-dd format

    // skip if schedule date with this date already exists
    const existingDate = schedule.dates.find(
      (date) => date.date == formattedTmpDate
    );
    if (existingDate) continue;

    // find date defintion based on day of week
    const dayOfWeek = getDateDayOfWeek(tmpDate);
    const dateDefinition = schedule.date_definitions.find(
      (date) => date.day_of_week == dayOfWeek
    );
    if (!dateDefinition) continue;

    // create a schedule date based on date definition
    const [scheduleDateID, dateError] = await tryCatcher<any>(
      datesService.createOne({
        date: formattedTmpDate,
        schedule: schedule.id,
      })
    );
    if (dateError) {
      logger.error(
        `Something went wrong while creating a schedule date: ${dateError}`
      );
      continue;
    }

    // create slots based on slot_definitions and store them in slots array
    const slots: any[] = [];
    dateDefinition.slot_definitions.forEach((slotDefinition) => {
      slots.push({
        start_time: slotDefinition.start_time,
        end_time: slotDefinition.end_time,
        available: slotDefinition.available,
        price: slotDefinition.price,
        date: scheduleDateID,
      });
    });

    // batch slots creation
    if (slots.length) {
      const [dateSlots, slotError] = await tryCatcher<any>(
        slotsService.createMany(slots)
      );
      if (slotError) {
        logger.error(
          `Something went wrong while creating a schedule date slots: ${slotError}`
        );
        continue;
      }
    }
  }
};

const handleTypeSports = async (
  context: any,
  schema: any,
  triggerData: TriggerData,
  service: any
) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const sportCourtsService = new ItemsService("sport_courts", {
    schema: schema,
    accountability: context.accountability,
  });

  const [sportCourts, error] = await tryCatcher<any[]>(
    sportCourtsService.readByQuery({
      fields: [
        "id",
        "schedule.id",
        "schedule.date_definitions.*",
        "schedule.date_definitions.slot_definitions.*",
        "schedule.dates.*",
      ],
      filter: {
        id: {
          _in: service.sport_courts,
        },
        schedule: {
          _nnull: true,
        },
      },
    })
  );
  if (error) {
    logger.error(`Something went wrong while reading sport_courts: ${error}`);
    return;
  }

  sportCourts.forEach(async (sportCourt) => {
    await createDatesAndSlots(
      context,
      schema,
      triggerData,
      sportCourt.schedule
    );
  });
};

const handleTypeHairdressing = async (
  context: any,
  schema: any,
  triggerData: TriggerData,
  service: any
) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const hairdressersService = new ItemsService("hairdressers", {
    schema: schema,
    accountability: context.accountability,
  });

  const [hairdressers, error] = await tryCatcher<any[]>(
    hairdressersService.readByQuery({
      fields: [
        "id",
        "schedule.id",
        "schedule.date_definitions.*",
        "schedule.date_definitions.slot_definitions.*",
        "schedule.dates.*",
      ],
      filter: {
        id: {
          _in: service.hairdressers,
        },
        schedule: {
          _nnull: true,
        },
      },
    })
  );
  if (error) {
    logger.error(`Something went wrong while reading hairdressers: ${error}`);
    return;
  }

  hairdressers.forEach(async (hairdresser) => {
    await createDatesAndSlots(
      context,
      schema,
      triggerData,
      hairdresser.schedule
    );
  });
};

const handleTypeWellness = async (
  context: any,
  schema: any,
  triggerData: TriggerData,
  service: any
) => {
  const logger = context.logger;
  const { ItemsService } = context.services;
  const wellnessService = new ItemsService("wellness", {
    schema: schema,
    accountability: context.accountability,
  });

  const [wellness, error] = await tryCatcher<any[]>(
    wellnessService.readByQuery({
      fields: [
        "id",
        "schedule.id",
        "schedule.date_definitions.*",
        "schedule.date_definitions.slot_definitions.*",
        "schedule.dates.*",
      ],
      filter: {
        id: {
          _in: service.wellnesses,
        },
        schedule: {
          _nnull: true,
        },
      },
    })
  );
  if (error) {
    logger.error(`Something went wrong while reading wellness: ${error}`);
    return;
  }

  wellness.forEach(async (wellns) => {
    await createDatesAndSlots(context, schema, triggerData, wellns.schedule);
  });
};

const getDateDayOfWeek = (date: Date) => {
  const dayOfWeek = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return dayOfWeek[date.getDay()];
};

const getDaysBetweenDates = (date1: Date, date2: Date) => {
  let Difference_In_Time = date2.getTime() - date1.getTime();

  // Calculating the no. of days between
  // two dates
  let differenceInDays = Math.ceil(Difference_In_Time / (1000 * 3600 * 24));

  return differenceInDays;
};

const getFormattedDate = (date: Date) => {
  return date.toISOString().split("T")[0];
};

export async function tryCatcher<T, E = Error>(
  promise: Promise<T>
): Promise<[T, null] | [null, E]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error as E];
  }
}
