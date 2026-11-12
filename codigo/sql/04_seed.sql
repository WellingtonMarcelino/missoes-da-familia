-- =====================================================================
-- DADOS INICIAIS — rodízio real, horários e opções
-- =====================================================================
insert into public.task_types (id, name, icon, points, category, default_start, default_due, guidance, optional, sort) values
 ('lavar_louca',   'Lavar a louça',                       '🍽️', 10, 'casa',   '13:15', '13:45', 'Use só detergente comum. Facas afiadas e panelas pesadas: chame um adulto.', false, 1),
 ('secar_louca',   'Secar e guardar a louça',             '🧺',  5, 'casa',   '13:15', '13:45', 'Guarde com cuidado o que for de vidro.', false, 2),
 ('guardar_alimentos','Guardar os alimentos do almoço',   '🥡',  5, 'casa',   '13:15', '13:45', 'Se a comida ainda estiver quente, chame um adulto antes de guardar.', false, 3),
 ('varrer',        'Varrer a casa',                       '🧹', 10, 'casa',   '13:15', '13:45', null, false, 4),
 ('banheiro',      'Organização leve do banheiro',        '🚿', 10, 'casa',   '13:15', '13:45', 'Organização leve: toalhas, pia e objetos no lugar. Nada de produtos químicos fortes.', false, 5),
 ('dobrar_roupas', 'Dobrar roupas',                       '👕',  5, 'casa',   '13:15', '13:45', null, false, 6),
 ('organizar',     'Organizar quarto, sala e pertences',  '🛏️',  5, 'casa',   '13:15', '13:45', 'De 5 a 10 minutinhos já fazem diferença!', false, 7),
 ('estudos',       'Deveres escolares e estudos',         '📚', 10, 'estudo', '13:45', '14:30', null, false, 8),
 ('leitura',       'Leitura de 20 minutos',               '📖',  5, 'estudo', '14:30', '14:50', null, false, 9),
 ('celular',       'Respeitar o horário do celular',      '📱',  5, 'rotina', '14:50', '15:50', 'Celular só no horário combinado: 14h50 às 15h50.', false, 10),
 ('mochila',       'Preparar mochila e uniforme',         '🎒',  5, 'rotina', '17:30', '19:30', null, false, 11),
 ('fogao',         'Limpar o fogão frio (opcional)',      '✨',  0, 'opcional','13:15','13:45', 'SOMENTE com o fogão completamente frio, com supervisão e autorização de um adulto. Só pano úmido.', true, 12);

insert into public.schedule_blocks (weekdays, start_time, end_time, label, icon, sort) values
 ('{1,2,3,4,5}', '12:30', '13:15', 'Almoço e descanso', '🍲', 1),
 ('{1,2,3,4,5}', '13:15', '13:45', 'Tarefas domésticas', '🧹', 2),
 ('{1,2,3,4,5}', '13:45', '14:30', 'Deveres escolares e estudos', '📚', 3),
 ('{1,2,3,4,5}', '14:30', '14:50', 'Leitura de 20 minutos', '📖', 4),
 ('{1,2,3,4,5}', '14:50', '15:50', 'Tempo combinado de celular', '📱', 5),
 ('{1,2,3,4,5}', '15:50', '17:30', 'Lanche, brincadeiras e tempo livre', '🧃', 6),
 ('{1,2,3,4,5}', '17:30', null,    'Banho, mochila, uniforme e convivência familiar', '🛁', 7),
 ('{0,6}',       '09:00', '18:00', 'Fim de semana: organização do banheiro e atividades opcionais', '☀️', 8);

insert into public.members (name, role, color, avatar, sort) values
 ('Filha A', 'child', '#ec4899', '🦋', 1),
 ('Filha B', 'child', '#8b5cf6', '🌻', 2),
 ('Filha C', 'child', '#10b981', '🐬', 3);

-- Rodízio EXATO (0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb)
with k as (select id from members where name = 'Filha A'),
     l as (select id from members where name = 'Filha B'),
     v as (select id from members where name = 'Filha C'),
     plan(weekday, who, task) as (values
  (1,'K','lavar_louca'),
  (1,'L','secar_louca'),(1,'L','guardar_alimentos'),(1,'L','dobrar_roupas'),
  (1,'V','varrer'),(1,'V','banheiro'),
  (2,'K','varrer'),(2,'K','banheiro'),
  (2,'L','lavar_louca'),
  (2,'V','secar_louca'),(2,'V','guardar_alimentos'),
  (3,'K','secar_louca'),(3,'K','guardar_alimentos'),(3,'K','dobrar_roupas'),
  (3,'L','varrer'),(3,'L','banheiro'),
  (3,'V','lavar_louca'),
  (4,'K','lavar_louca'),
  (4,'L','secar_louca'),(4,'L','guardar_alimentos'),
  (4,'V','varrer'),(4,'V','banheiro'),
  (5,'K','varrer'),(5,'K','banheiro'),
  (5,'L','lavar_louca'),
  (5,'V','secar_louca'),(5,'V','guardar_alimentos'),(5,'V','dobrar_roupas'),
  (6,'L','banheiro'),
  (0,'V','banheiro'))
insert into public.rotation (weekday, member_id, task_type_id, due_time)
select p.weekday,
       case p.who when 'K' then (select id from k) when 'L' then (select id from l) else (select id from v) end,
       p.task,
       case when p.weekday in (0,6) then '18:00'::time end
  from plan p;

-- Rotina de segunda a sexta para as três
insert into public.rotation (weekday, member_id, task_type_id)
select d, m.id, t from members m, generate_series(1,5) d,
  unnest(array['organizar','estudos','leitura','celular','mochila']) t
 where m.role = 'child';

-- Quinta: fogão frio, opcional e sem pontos
insert into public.rotation (weekday, member_id, task_type_id)
select 4, id, 'fogao' from members where role = 'child';

insert into public.reward_options (title, emoji, est_cost, description) values
 ('Passeio especial', '🎡', 150, 'Um passeio escolhido pelas três'),
 ('Cinema', '🎬', 120, 'Filme no cinema com pipoca'),
 ('Piquenique', '🧺', 60, 'Piquenique no parque'),
 ('Noite de pizza', '🍕', 100, 'Pizza em casa com a família'),
 ('Presente coletivo', '🎁', 150, 'Um presente para as três dividirem'),
 ('Experiência em família', '🌈', 100, 'Uma experiência especial juntos');

insert into public.family_day_options (title, emoji) values
 ('Jogos de tabuleiro', '🎲'), ('Filme em família', '🎬'), ('Roda de conversa', '💬'),
 ('Brincadeiras', '🤸'), ('Lanche especial juntos', '🍪'), ('Música e dança', '🎶');

insert into public.family_missions (title, emoji, description) values
 ('Organizar uma estante juntas', '📚', 'As três escolhem uma estante e deixam tudo lindo.'),
 ('Preparar uma brincadeira para a família', '🎈', 'Inventem uma brincadeira para o Dia da Família.'),
 ('Escolher um livro para ler juntas', '📖', 'Escolham um livro e combinem um capítulo por semana.'),
 ('Ajudar a preparar o Dia da Família', '🎉', 'Decoração, lanche ou convite — vocês decidem!');
