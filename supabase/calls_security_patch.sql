-- Restrict private call signaling to the two authenticated members of a pair.
drop policy if exists he_pair_call_signal_read on realtime.messages;
create policy he_pair_call_signal_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (select 1 from public.couples c where realtime.topic() = 'he-call-' || c.id::text and public.is_couple_member(c.id))
  );
drop policy if exists he_pair_call_signal_send on realtime.messages;
create policy he_pair_call_signal_send on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and exists (select 1 from public.couples c where realtime.topic() = 'he-call-' || c.id::text and public.is_couple_member(c.id))
  );
