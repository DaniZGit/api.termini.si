import { defineOperationApi, useApi } from "@directus/extensions-sdk";
import { env } from "process";

type Options = {
  text: string;
};

export default defineOperationApi<Options>({
  id: "update-time-slots-weather",
  handler: async (options, context) => {
    const schema = await context.getSchema();

    console.log("fetching weather data");
    const { data: institutions, error: institutionsError } =
      await fetchInstitutions(schema, context);
    if (institutionsError) {
      console.log(institutionsError);
      return;
    }

    institutions.forEach((institution) => {
      updateTimeSlots(schema, context, institution);
    });

    // const currDate = getCurrentDateInSloTimezone()
    // const timeSlots = timeSlotsService.readByQuery({
    // 	filter: {

    // 	}
    // })
  },
});

const fetchInstitutions = async (schema, context) => {
  let institutions = [];
  let error = "";

  const { ItemsService } = context.services;
  const institutionsService = new ItemsService("institutions", {
    schema: schema,
  });

  try {
    institutions = await institutionsService.readByQuery({
      filter: {
        status: {
          _eq: "published",
        },
      },
    });
  } catch (error) {
    error = "Something went wrong while fetching institutions";
  }

  return { data: institutions, error: error };
};

const updateTimeSlots = async (schema, context, institution) => {
  const { ItemsService } = context.services;
  const scheduleDaysService = new ItemsService("schedule_days", {
    schema: schema,
  });
  const timeSlotsService = new ItemsService("time_slots", {
    schema: schema,
  });

  const currDate = getCurrentDateInSloTimezone();
  const dateInFourDays = getCurrentDateInSloTimezone();
  dateInFourDays.setDate(dateInFourDays.getDate() + 4);

  try {
    const scheduleDays = await scheduleDaysService.readByQuery({
      fields: ["id", "date", "time_slots.*"],
      filter: {
        _and: [
          {
            court: {
              institution: {
                id: {
                  _eq: institution.id,
                },
              },
            },
          },
          {
            date: {
              _gte: currDate.toISOString().split("T")[0],
            },
          },
          {
            date: {
              _lte: dateInFourDays.toISOString().split("T")[0],
            },
          },
        ],
      },
    });

    for (let i = 0; i < scheduleDays.length; i++) {
      const scheduleDay = scheduleDays[i];
      const { data: weatherData, error: weatherError } = await fetchWeatherData(
        institution.latitude,
        institution.longitude,
        scheduleDay.date
      );
      if (weatherError) {
        console.log(weatherError);
        return;
      }

      if (weatherData.days.length) {
        for (let k = 0; k < scheduleDay.time_slots.length; k++) {
          const timeSlot = scheduleDay.time_slots[k];
          // console.log("time slot start_time", timeSlot.start_time);
          const hourData = weatherData.days[0].hours.find(
            (hour) => hour.datetime == timeSlot.start_time
          );

          if (hourData) {
            // console.log(
            //   "updaitng time slot",
            //   timeSlot.id,
            //   " with temp ",
            //   hourData.temp
            // );
            await timeSlotsService.updateOne(timeSlot.id, {
              current_temp: hourData.temp,
            });
          }
        }
        // console.log(
        //   "weather data: ",
        //   weatherData.days[0].datetime,
        //   weatherData.days[0].temp,
        //   weatherData.days[0].hours
        //   weatherData.days[0].hours.datetime
        //   weatherData.days[0].hours.icon
        // );
      }
    }
  } catch (err) {
    const error = "Something went wrong while doign weather slots";
    console.log(error, err);
  }
};

const fetchWeatherData = async (lat, lon, date) => {
  const weatherApiURL =
    "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline";
  let data = {};
  let error = "";

  try {
    const response = await fetch(
      `${weatherApiURL}/${46.053223071666245},${14.507033769322653}/${date}?key=${
        env.WEATHER_API_KEY
      }&unitGroup=metric`
    );

    if (!response.ok) {
      error = "Weather data response is not OK";
      console.log(await response.json());
    } else {
      data = await response.json();
    }
  } catch (error) {
    error = "Something went wrong while fetching weather data";
  }

  return { data: data, error: error };
};

const niceError = (res: any, status: number, message: any) => {
  return res.status(status).send(message);
};

const getCurrentDateInSloTimezone = () => {
  // Create an Intl.DateTimeFormat object for Slovenia
  const options = {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  const formatter = new Intl.DateTimeFormat("en-US", options);

  // Get the current date and time in Slovenia
  const parts = formatter.formatToParts(new Date());

  // Extract the components from the formatted date
  const getPart = (type) => parts.find((part) => part.type === type).value;

  // Construct a string in the format 'YYYY-MM-DDTHH:mm:ss' for easier parsing
  const dateTimeString = `${getPart("year")}-${getPart("month")}-${getPart(
    "day"
  )}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;

  // Parse the string back into a Date object (in local time)
  const slovenianDate = new Date(dateTimeString);

  return slovenianDate;
};
