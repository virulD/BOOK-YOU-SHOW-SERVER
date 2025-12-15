import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Event, EventDocument } from '../schemas/event.schema';
import { Seat, SeatDocument } from '../schemas/seat.schema';
import { EventType } from '../schemas/event.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const eventModel = app.get<Model<EventDocument>>(getModelToken(Event.name));
  const seatModel = app.get<Model<SeatDocument>>(getModelToken(Seat.name));

  // Clear existing data
  await eventModel.deleteMany({});
  await seatModel.deleteMany({});

  // Create demo event
  const demoEvent = new eventModel({
    organizerId: 'demo-organizer-1',
    title: 'Sri Lanka Music Festival 2024',
    description: 'An amazing live music event featuring top artists from Sri Lanka',
    startAt: new Date('2024-12-25T18:00:00Z'),
    endAt: new Date('2024-12-25T22:00:00Z'),
    timezone: 'Asia/Colombo',
    venue: {
      name: 'Nelum Pokuna Mahinda Rajapaksa Theatre',
      address: 'Ananda Coomaraswamy Mawatha, Colombo 00700',
      capacity: 500,
    },
    eventType: EventType.RESERVED,
    defaultPrice: 550,
    commission: {
      type: 'percentage',
      value: 10,
    },
  });

  const savedEvent = await demoEvent.save();

  // Create seats based on the provided floor plan
  // BOX-BOX Section (3 rows: AM, BM, CM, 10 seats each)
  const boxRows = ['AM', 'BM', 'CM'];
  const boxSeats: Seat[] = [];

  boxRows.forEach((row, rowIndex) => {
    for (let i = 1; i <= 10; i++) {
      boxSeats.push({
        eventId: savedEvent._id,
        label: `${row}-${i}`,
        section: 'BOX-BOX',
        row: row,
        number: i,
        x: 0.1 + (i - 1) * 0.08,
        y: 0.1 + rowIndex * 0.15,
        width: 0.06,
        height: 0.12,
        basePrice: 650,
        seatType: 'regular',
        state: 'available',
      } as any);
    }
  });

  // ODC-ODC Section (13 rows: A-M)
  const odcRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  const odcSeats: Seat[] = [];

  odcRows.forEach((row, rowIndex) => {
    let leftSeats = 0;
    let rightSeats = 0;

    // Row A: only right block (9 seats)
    if (row === 'A') {
      rightSeats = 9;
    }
    // Rows B-C: left 6-7, right 7-14
    else if (row === 'B') {
      leftSeats = 6;
      rightSeats = 7;
    } else if (row === 'C') {
      leftSeats = 7;
      rightSeats = 7;
    }
    // Rows D-J: left 7, right 14
    else if (['D', 'E', 'F', 'G', 'H', 'I', 'J'].includes(row)) {
      leftSeats = 7;
      rightSeats = 7;
    }
    // Rows K-M: left 7, right 5
    else if (['K', 'L', 'M'].includes(row)) {
      leftSeats = 7;
      rightSeats = 5;
    }

    let seatNumber = 1;

    // Left block
    for (let i = 0; i < leftSeats; i++) {
      odcSeats.push({
        eventId: savedEvent._id,
        label: `${row}${seatNumber}`,
        section: 'ODC-ODC',
        row: row,
        number: seatNumber,
        x: 0.05 + i * 0.08,
        y: 0.35 + rowIndex * 0.05,
        width: 0.06,
        height: 0.04,
        basePrice: 550,
        seatType: 'regular',
        state: 'available',
      } as any);
      seatNumber++;
    }

    // Right block (with gap for aisle)
    const rightStartX = 0.55;
    for (let i = 0; i < rightSeats; i++) {
      odcSeats.push({
        eventId: savedEvent._id,
        label: `${row}${seatNumber}`,
        section: 'ODC-ODC',
        row: row,
        number: seatNumber,
        x: rightStartX + i * 0.08,
        y: 0.35 + rowIndex * 0.05,
        width: 0.06,
        height: 0.04,
        basePrice: 550,
        seatType: 'regular',
        state: 'available',
      } as any);
      seatNumber++;
    }
  });

  // Insert all seats
  await seatModel.insertMany([...boxSeats, ...odcSeats]);

  console.log(`✅ Created demo event: ${savedEvent.title}`);
  console.log(`✅ Created ${boxSeats.length} BOX-BOX seats`);
  console.log(`✅ Created ${odcSeats.length} ODC-ODC seats`);
  console.log(`\nEvent ID: ${savedEvent._id}`);
  console.log(`View at: http://localhost:3001/events/${savedEvent._id}`);

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error seeding database:', err);
  process.exit(1);
});

