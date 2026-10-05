import { getStoreSession } from "@/auth";
import { BookingForm } from "@/components/booking-form";
import { tokyoBusinessDate } from "@/lib/schedules/calendar";

export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await getStoreSession();
  const isMemberLoggedIn = session?.user.role === "MEMBER";
  return (
    <BookingForm
      initialToday={tokyoBusinessDate(new Date())}
      isMemberLoggedIn={isMemberLoggedIn}
    />
  );
}
