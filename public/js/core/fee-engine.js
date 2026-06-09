const FeeEngine = (() => {
  const BASE_FEE = 5;
  const OVERWEIGHT_THRESHOLD_KG = 3;
  const OVERWEIGHT_SURCHARGE = 2;

  function _round2(n) {
    return Math.round(n * 100) / 100;
  }

  function isNightTime(date) {
    const d = date || new Date();
    const hour = d.getHours();
    return hour >= Models.NIGHT_TIME.start || hour < Models.NIGHT_TIME.end;
  }

  function getWeightTier(weightKg) {
    const tiers = Models.WEIGHT_TIERS;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (weightKg > tiers[i].min) {
        return tiers[i];
      }
    }
    return tiers[0];
  }

  function getDistanceTier(distanceKm) {
    const tiers = Models.DISTANCE_TIERS;
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (distanceKm > tiers[i].min) {
        return tiers[i];
      }
    }
    return tiers[0];
  }

  function isOverWeight(weightKg) {
    return weightKg > OVERWEIGHT_THRESHOLD_KG;
  }

  function checkCouponMutex(newCoupon, existingCoupon) {
    if (!existingCoupon || !newCoupon) return { valid: true };
    const mutexKey = existingCoupon.mutexGroup || 'FULL';
    const mutexTypes = Models.COUPON_MUTEX_GROUPS[mutexKey] || Models.COUPON_MUTEX_GROUPS.FULL;
    if (mutexTypes.includes(newCoupon.type)) {
      return {
        valid: false,
        conflictCoupon: existingCoupon,
        reason: '与已选"' + existingCoupon.name + '"互斥（' + mutexKey + '组）'
      };
    }
    return { valid: true };
  }

  function calculateCouponDiscount(coupon, originalTotal) {
    if (!coupon || coupon.used) {
      return { amount: 0, coupon: null, note: null };
    }

    if (originalTotal < (coupon.minAmount || 0)) {
      return { amount: 0, coupon, note: '未满足最低消费' };
    }

    let discount = 0;
    switch (coupon.type) {
      case Models.COUPON_TYPES.AMOUNT:
        discount = coupon.value;
        break;
      case Models.COUPON_TYPES.PERCENT:
        discount = _round2(originalTotal * (coupon.value / 100));
        break;
      case Models.COUPON_TYPES.FREESHIP:
        discount = _round2(Math.min(originalTotal, BASE_FEE));
        break;
      default:
        return { amount: 0, coupon, note: '未知券类型' };
    }

    if (discount > originalTotal) {
      discount = originalTotal;
    }

    return {
      amount: _round2(discount),
      coupon,
      note: null
    };
  }

  function calculate(orderData) {
    const detail = Models.createFeeDetail();
    const weightKg = orderData.weightKg || 0;
    const distanceKm = orderData.distanceKm || 0;

    detail.baseFee = {
      name: '基础配送费',
      amount: BASE_FEE,
      description: '基础服务费（起步）'
    };

    const weightTier = getWeightTier(weightKg);
    detail.weightFee = {
      name: '重量阶梯费',
      amount: weightTier.fee,
      description: '重量' + weightKg + 'kg，' + weightTier.label,
      tier: weightTier
    };

    const distanceTier = getDistanceTier(distanceKm);
    detail.distanceFee = {
      name: '距离附加费',
      amount: distanceTier.fee,
      description: '距离' + distanceKm + 'km，' + distanceTier.label,
      tier: distanceTier
    };

    const isNight = typeof orderData.isNight !== 'undefined'
      ? orderData.isNight
      : isNightTime();
    detail.nightFee = {
      name: '夜间附加费',
      amount: isNight ? Models.NIGHT_TIME.fee : 0,
      description: isNight
        ? Models.NIGHT_TIME.label + ' ' + Models.NIGHT_TIME.start + ':00-' + Models.NIGHT_TIME.end + ':00'
        : '非夜间时段',
      enabled: isNight
    };

    const originalTotal = _round2(
      detail.baseFee.amount +
      detail.weightFee.amount +
      detail.distanceFee.amount +
      detail.nightFee.amount
    );
    detail.originalTotal = originalTotal;

    const couponResult = calculateCouponDiscount(orderData.coupon, originalTotal);
    detail.couponDiscount = {
      name: '优惠券抵扣',
      amount: couponResult.amount,
      description: couponResult.coupon
        ? couponResult.coupon.code + '-' + couponResult.coupon.name +
          '：-¥' + couponResult.amount.toFixed(2) +
          (couponResult.note ? '（' + couponResult.note + '）' : '')
        : '未使用优惠券',
      couponId: couponResult.coupon ? couponResult.coupon.id : null
    };

    detail.finalTotal = _round2(originalTotal - detail.couponDiscount.amount);

    const overweight = isOverWeight(weightKg);
    const overweightFee = overweight
      ? _round2((weightKg - OVERWEIGHT_THRESHOLD_KG) * OVERWEIGHT_SURCHARGE)
      : 0;
    detail.overweight = {
      required: overweight,
      thresholdKg: OVERWEIGHT_THRESHOLD_KG,
      surchargePerKg: OVERWEIGHT_SURCHARGE,
      additionalFee: overweightFee,
      confirmed: !!orderData.overWeightConfirmed,
      description: overweight
        ? '超重提示：超过' + OVERWEIGHT_THRESHOLD_KG + 'kg部分,' +
          (weightKg - OVERWEIGHT_THRESHOLD_KG) + 'kg,额外¥' + overweightFee.toFixed(2) + '（需确认）'
        : null
    };

    detail.overweightTotal = _round2(detail.finalTotal + overweightFee);

    return detail;
  }

  function calculateCancellationPenalty(order, cancelTime) {
    const rule = Models.CANCEL_RULES.find(r => r.status === order.status);
    if (!rule) {
      return {
        canCancel: false,
        penalty: 0,
        reason: '此状态不可取消',
        rule: null
      };
    }
    if (!rule.canCancel) {
      return {
        canCancel: false,
        penalty: 0,
        reason: '订单已完成或处理中，不可取消',
        rule
      };
    }
    const total = (order.feeDetail && order.feeDetail.finalTotal) || order.totalAmount || 0;
    const penalty = _round2(total * rule.penaltyRate);
    return {
      canCancel: true,
      penalty,
      penaltyRate: rule.penaltyRate,
      reason: rule.penaltyRate > 0
        ? '违约金：按' + (rule.penaltyRate * 100) + '%，共¥' + penalty.toFixed(2)
        : '无违约金',
      rule
    };
  }

  async function validateAndSaveCalculation(orderId, detail) {
    const record = {
      id: Models.generateId('fee_'),
      orderId,
      timestamp: Date.now(),
      detail
    };
    await DB.open();
    await DB.put(DB.STORES.feeCalculations, record);
    await Audit.log(
      Audit.ACTIONS.FEE_CALCULATE,
      orderId,
      { finalTotal: detail.finalTotal, overweight: detail.overweight },
      'INFO'
    );
    return record;
  }

  function recalculateOrder(order, updates) {
    const merged = Object.assign({}, order, updates || {});
    return calculate(merged);
  }

  function formatFeeDisplay(detail) {
    const lines = [];
    lines.push({ label: detail.baseFee.name, amount: detail.baseFee.amount.toFixed(2) });
    if (detail.weightFee.amount > 0) {
      lines.push({
        label: detail.weightFee.name + ' (' + detail.weightFee.description + ')',
        amount: detail.weightFee.amount.toFixed(2)
      });
    }
    if (detail.distanceFee.amount > 0) {
      lines.push({
        label: detail.distanceFee.name + ' (' + detail.distanceFee.description + ')',
        amount: detail.distanceFee.amount.toFixed(2)
      });
    }
    if (detail.nightFee.enabled) {
      lines.push({
        label: detail.nightFee.name + ' (' + detail.nightFee.description + ')',
        amount: detail.nightFee.amount.toFixed(2)
      });
    }
    if (detail.couponDiscount.amount > 0) {
      lines.push({
        label: detail.couponDiscount.name + ' (' + detail.couponDiscount.description + ')',
        amount: '-' + detail.couponDiscount.amount.toFixed(2),
        isDiscount: true
      });
    }
    if (detail.overweight && detail.overweight.required) {
      lines.push({
        label: '超重附加费 (' + detail.overweight.description + ')',
        amount: '+' + detail.overweight.additionalFee.toFixed(2),
        isOverweight: true
      });
    }
    return lines;
  }

  return {
    BASE_FEE,
    OVERWEIGHT_THRESHOLD_KG,
    OVERWEIGHT_SURCHARGE,
    isNightTime,
    getWeightTier,
    getDistanceTier,
    isOverWeight,
    checkCouponMutex,
    calculateCouponDiscount,
    calculate,
    calculateCancellationPenalty,
    validateAndSaveCalculation,
    recalculateOrder,
    formatFeeDisplay
  };
})();
