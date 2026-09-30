import { BookingForm } from "@/components/booking-form";
import { tokyoBusinessDate } from "@/lib/schedules/calendar";

export const dynamic = "force-dynamic";
export default function Page() {
  return <BookingForm initialToday={tokyoBusinessDate(new Date())} />;
}
