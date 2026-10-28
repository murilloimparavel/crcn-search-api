const { cleanText } = require('./normalizer');

function translated(value) {
  if (typeof value === 'string') return value;
  return value?.pt_BR || value?.en_US || Object.values(value || {}).find((item) => typeof item === 'string' && item) || '';
}

function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function count(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumAmounts(items) {
  const total = items.reduce((sum, item) => {
    const value = Number(item?._f_val);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
}

function confirmsPendingPaymentByChannel(channelName) {
  const channel = String(channelName || '').toLocaleLowerCase('pt-BR');
  if (channel.includes('booking')) return false;
  return ['airbnb', 'decolar', 'expedia'].some((name) => channel.includes(name));
}

function normalizeReservationStatus(type, channelName) {
  const channel = String(channelName || '').toLocaleLowerCase('pt-BR');
  if (type === 'reserved' && channel.includes('booking')) {
    return { codigo: type, nome: 'Pré-reserva', descricao: 'A reserva ainda não está confirmada no Stays.' };
  }
  const statuses = {
    booked: { codigo: type, nome: 'Confirmada no Stays', descricao: 'A reserva consta como booked no Stays.' },
    reserved: { codigo: type, nome: 'Reservada', descricao: 'A reserva consta como reserved no Stays; não trate como confirmada.' },
    contract: { codigo: type, nome: 'Contrato', descricao: 'A reserva consta como contract no Stays.' },
    canceled: { codigo: type, nome: 'Cancelada', descricao: 'A reserva consta como canceled no Stays.' },
    blocked: { codigo: type, nome: 'Bloqueio', descricao: 'O registro consta como bloqueio de calendário.' },
    maintenance: { codigo: type, nome: 'Manutenção', descricao: 'O registro consta como manutenção.' }
  };
  return statuses[type] || { codigo: type || 'unknown', nome: 'Não identificado', descricao: 'O Stays retornou um estado não mapeado.' };
}

function normalizePayment(reservation, payments) {
  if (!Array.isArray(payments)) {
    return {
      status: 'indisponivel',
      nome_status: 'Não foi possível verificar',
      moeda: reservation?.price?.currency || 'BRL',
      valor_total: amount(reservation?.price?._f_total ?? reservation?.price?._f_expected),
      valor_pago_informado_stays: amount(reservation?.stats?._f_totalPaid),
      valor_pago_confirmado: null,
      valor_a_confirmar: null,
      valor_pendente: null,
      regra_aplicada: null,
      quantidade_lancamentos: null,
      lancamentos_por_status: [],
      descricao: 'A consulta de lançamentos de pagamento não ficou disponível. Não conclua que o pagamento está completo.'
    };
  }

  const credits = payments.filter((item) => item?.type === 'credit');
  const completed = credits.filter((item) => item?.status === 'completed');
  const pending = credits.filter((item) => item?.status === 'pending');
  const total = amount(reservation?.price?._f_total ?? reservation?.price?._f_expected);
  const paidByPayments = sumAmounts(completed);
  const pendingByPayments = sumAmounts(pending);
  const paidReportedByStays = amount(reservation?.stats?._f_totalPaid);
  const creditStatuses = [...new Set(credits.map((item) => item?.status).filter(Boolean))];
  const channel = reservation?.partner?.name || '';
  const channelConfirmsPayment = confirmsPendingPaymentByChannel(channel) && pendingByPayments > 0;
  let status = 'indisponivel';
  let description = 'Os dados disponíveis não permitem determinar se o pagamento foi concluído.';
  let paymentRule = null;

  if (channelConfirmsPayment) {
    status = 'pago';
    paymentRule = 'a_confirmar_por_canal';
    description = `Há R$ ${pendingByPayments.toFixed(2)} em lançamentos “A confirmar” para o canal ${channel}. Pela regra operacional da CRCN, considere o pagamento aprovado para prosseguir com o voucher. Isso não confirma o repasse bancário.`;
  } else if (total !== null && pending.length && paidReportedByStays !== null && paidReportedByStays >= total) {
    status = 'divergente';
    description = 'O total pago informado nas estatísticas diverge dos lançamentos de crédito, que ainda aparecem pendentes. Encaminhe para conferência financeira.';
  } else if (total !== null && pending.length) {
    status = completed.length ? 'parcial' : 'pendente';
    description = completed.length
      ? 'Há pagamentos concluídos e lançamentos pendentes; o pagamento total ainda não foi comprovado.'
      : 'Há lançamentos de crédito pendentes; o pagamento total ainda não foi comprovado.';
  } else if (total !== null && completed.length && paidByPayments >= total) {
    status = 'pago';
    description = 'Os lançamentos de crédito concluídos cobrem o valor total da reserva.';
  } else if (total !== null && completed.length) {
    status = 'parcial';
    description = 'Os pagamentos de crédito concluídos ainda não cobrem o valor total da reserva.';
  }

  const labels = {
    pago: 'Pagamento concluído',
    parcial: 'Pagamento parcial',
    pendente: 'Pagamento pendente',
    divergente: 'Dados de pagamento divergentes',
    indisponivel: 'Pagamento não confirmado'
  };

  return {
    status,
    nome_status: channelConfirmsPayment ? 'Pagamento aprovado pela regra do canal' : labels[status],
    moeda: reservation?.price?.currency || 'BRL',
    valor_total: total,
    valor_pago_informado_stays: paidReportedByStays,
    valor_pago_confirmado: paidByPayments,
    valor_a_confirmar: pendingByPayments,
    valor_pendente: pendingByPayments,
    regra_aplicada: paymentRule,
    quantidade_lancamentos: payments.length,
    lancamentos_por_status: [...new Set(payments.map((item) => item?.status).filter(Boolean))]
      .sort()
      .map((itemStatus) => ({
        codigo: itemStatus,
        nome: itemStatus === 'completed' ? 'Concluído' : itemStatus === 'pending' ? 'Pendente' : 'Não identificado',
        quantidade: payments.filter((item) => item?.status === itemStatus).length
      })),
    tipos_de_lancamento: [...new Set(payments.map((item) => item?.type).filter(Boolean))].sort(),
    total_creditos_concluidos: paidByPayments,
    total_creditos_pendentes: pendingByPayments,
    statuses_dos_creditos: creditStatuses,
    descricao: description
  };
}

function normalizeReservation({ reservation, payments, listing, property }) {
  const channel = cleanText((reservation?.partner || {}).name || '') || null;
  const propertyName = cleanText(translated(property?._mstitle) || property?.internalName || '');
  const listingName = cleanText(translated(listing?._mstitle) || listing?.internalName || '');
  const rawDescription = translated(listing?._msdesc) || translated(listing?._mssummary) || '';
  const description = cleanText(rawDescription).slice(0, 6000) || null;
  const payment = normalizePayment(reservation, payments);
  const status = normalizeReservationStatus(reservation?.type, channel);
  const guests = reservation?.guestsDetails || {};
  const guestCount = count(reservation?.guests);
  const eligibleStatuses = ['booked'];
  const reservationEligible = eligibleStatuses.includes(reservation?.type);
  const paymentEligible = payment.status === 'pago';
  const missingStayFields = [
    ...(!reservation?.checkInDate ? ['data de check-in'] : []),
    ...(!reservation?.checkOutDate ? ['data de check-out'] : []),
    ...(guestCount === null ? ['quantidade de hóspedes'] : []),
    ...(!listingName ? ['nome do apartamento'] : []),
    ...(!propertyName ? ['nome do condomínio'] : []),
    ...(!description ? ['descrição do apartamento'] : [])
  ];
  const stayDetailsReady = missingStayFields.length === 0;
  const canProceed = reservationEligible && paymentEligible && stayDetailsReady;
  let instruction;
  if (payment.status === 'divergente' || payment.status === 'indisponivel' || payment.status === 'pendente' || payment.status === 'parcial') {
    instruction = 'Não diga que o pagamento está completo nem avance para coleta de dados do voucher. Explique a situação retornada e encaminhe para conferência financeira/humana.';
  } else if (!reservationEligible) {
    instruction = 'Não diga que a reserva está confirmada nem avance para coleta de dados do voucher. Explique o status retornado e encaminhe para atendimento humano.';
  } else if (!stayDetailsReady) {
    instruction = `Faltam dados da hospedagem (${missingStayFields.join(', ')}). Não confirme todos os detalhes nem avance para coleta do voucher; encaminhe para conferência humana.`;
  } else {
    instruction = 'Apresente os dados da hospedagem e pergunte se estão corretos. Depois da confirmação do hóspede, solicite os dados necessários para emissão do voucher.';
  }

  return {
    status: {
      ...status,
      pode_seguir_para_voucher: canProceed
    },
    canal: channel,
    check_in: {
      data: reservation?.checkInDate || null,
      horario: reservation?.checkInTime || null
    },
    check_out: {
      data: reservation?.checkOutDate || null,
      horario: reservation?.checkOutTime || null
    },
    hospedes: {
      total: guestCount,
      adultos: count(guests.adults),
      criancas: count(guests.children),
      bebes: count(guests.infants)
    },
    imovel: {
      apartamento: listingName || null,
      condominio: propertyName || null,
      descricao: description
    },
    pagamento: payment,
    dados_da_hospedagem_completos: stayDetailsReady,
    dados_da_hospedagem_ausentes: missingStayFields,
    orientacao_para_ia: instruction,
    resumo_amigavel: [
      `Situação da reserva: ${status.nome}.`,
      `Situação do pagamento: ${payment.nome_status}.`,
      `Check-in: ${reservation?.checkInDate || 'não informado'}${reservation?.checkInTime ? ` às ${reservation.checkInTime}` : ''}.`,
      `Check-out: ${reservation?.checkOutDate || 'não informado'}${reservation?.checkOutTime ? ` às ${reservation.checkOutTime}` : ''}.`,
      `Hóspedes: ${guestCount === null ? 'quantidade não informada' : guestCount}.`,
      `Apartamento: ${listingName || 'não identificado'}.`,
      `Condomínio: ${propertyName || 'não identificado'}.`,
      description ? `Descrição do apartamento: ${description}` : 'Descrição do apartamento: não disponível.'
    ].join(' ')
  };
}

module.exports = { normalizeReservation, normalizePayment, normalizeReservationStatus };
