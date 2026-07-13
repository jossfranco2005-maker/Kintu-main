-- Habilita la eliminación individual de notificaciones para usuarios autenticados
GRANT DELETE ON public.notifications TO authenticated;

CREATE POLICY "own notifications delete"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
