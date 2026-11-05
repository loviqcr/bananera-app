-- La deshija no tenía un campo de cantidad (a diferencia de fertilización y
-- nematicida, que sí), así que no se podía registrar cuánto se deshijó.
ALTER TABLE labores_deshija ADD COLUMN cantidad NUMERIC;
