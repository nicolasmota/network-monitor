const LABELS = [
  [85, "Excellent"],
  [70, "Good"],
  [50, "Unstable"],
  [0, "Slow"],
];

export function sameChannelCount(wifi, nearby) {
  if (!wifi?.connected || wifi.channel == null) return 0;
  return (nearby || []).filter(
    (network) => network.channel === wifi.channel && network.ssid !== wifi.ssid,
  ).length;
}

export function isSaturated(downBps, linkBps) {
  if (!downBps || !linkBps) return false;
  return downBps * 8 > linkBps * 0.7;
}

export function interpret(snapshot) {
  const reasons = [];
  let score = 100;
  const wifi = snapshot.wifi;
  const inet = snapshot.latency?.internet;
  const gateway = snapshot.latency?.gateway;
  const dns = snapshot.latency?.dns;
  const crowded = sameChannelCount(wifi, snapshot.nearby);
  const airtime = currentAirtime(wifi, snapshot.nearby);
  const saturated = isSaturated(snapshot.downBps, snapshot.linkBps);

  if (wifi?.available && wifi.connected) {
    const signal = wifi.signal;
    if (signal != null && signal < 40) {
      score -= 35;
      reasons.push(`Weak signal (${signal}%).`);
    } else if (signal != null && signal < 60) {
      score -= 18;
      reasons.push(`Medium signal (${signal}%).`);
    } else if (signal != null && signal < 75) {
      score -= 6;
      reasons.push(`Fair signal (${signal}%).`);
    }
    if (wifi.rssi != null && wifi.rssi <= -80) {
      score -= 8;
      reasons.push(`Low RSSI (${wifi.rssi} dBm).`);
    }
  } else if (!snapshot.ethernetUp) {
    score -= 40;
    reasons.push("Wi-Fi is disconnected.");
  }

  if (!inet || inet.avg == null) {
    if (snapshot.probesReady) {
      score -= 30;
      reasons.push("The internet ping timed out.");
    }
  } else {
    if (inet.loss >= 20) {
      score -= 35;
      reasons.push(`High packet loss to the internet (${inet.loss}%).`);
    } else if (inet.loss > 0) {
      score -= 12;
      reasons.push(`Packet loss to the internet (${inet.loss}%).`);
    }
    if (inet.avg >= 150) {
      score -= 35;
      reasons.push(`High latency to the internet (${inet.avg} ms).`);
    } else if (inet.avg >= 80) {
      score -= 16;
      reasons.push(`Elevated latency to the internet (${inet.avg} ms).`);
    } else if (inet.avg >= 50) {
      score -= 4;
    }
    if (inet.jitter >= 40) {
      score -= 12;
      reasons.push(`Latency is swinging (${inet.jitter} ms).`);
    } else if (inet.jitter >= 25) {
      score -= 6;
      reasons.push(`Latency variation (${inet.jitter} ms).`);
    }
  }

  if (gateway?.avg != null && gateway.avg >= 25) {
    score -= 12;
    reasons.push(`The router is slow to answer (${gateway.avg} ms).`);
  } else if (gateway?.loss != null && gateway.loss >= 10) {
    score -= 10;
    reasons.push(`Packet loss to the router (${gateway.loss}%).`);
  }

  if (dns && dns.ok === false) {
    score -= 10;
    reasons.push("DNS failed to resolve.");
  } else if (dns?.ms != null && dns.ms >= 400) {
    score -= 8;
    reasons.push(`Slow DNS (${dns.ms} ms).`);
  }

  if (crowded >= 3) {
    score -= 6;
    reasons.push(`${crowded} networks on the same channel (${wifi.channel}).`);
  }
  if (airtime != null && airtime >= 50) {
    score -= 10;
    reasons.push(`The channel is busy (${airtime}% of the time).`);
  }
  if (saturated) {
    score -= 8;
    reasons.push("The link is almost full.");
  }

  score = Math.max(0, Math.min(100, score));
  const label = LABELS.find(([min]) => score >= min)?.[1] ?? "Slow";
  if (reasons.length === 0) reasons.push("Reading is steady.");

  return {
    health: { score, label, reasons: reasons.slice(0, 5) },
    diagnosis: diagnose(snapshot, crowded, saturated, airtime),
  };
}

export function currentAirtime(wifi, nearby) {
  if (!wifi?.ssid) return null;
  const here = (nearby || []).find((network) => network.ssid === wifi.ssid);
  return here?.utilization ?? null;
}

function diagnose(snapshot, crowded, saturated, airtime) {
  const lines = [];
  const wifi = snapshot.wifi;
  const inet = snapshot.latency?.internet;
  const gateway = snapshot.latency?.gateway;

  if (gateway?.avg != null && inet?.avg != null) {
    if (gateway.avg >= 20 && inet.avg >= 80) {
      lines.push(
        "The router answers slowly. The wait starts at home: signal, interference, or the router itself.",
      );
    } else if (gateway.avg < 10 && inet.avg >= 80) {
      lines.push("The home network answers quickly. The wait is on the path to the internet.");
    } else if (
      inet.avg < 60 &&
      gateway.avg < 20 &&
      (inet.loss ?? 0) === 0 &&
      (wifi?.signal ?? 100) >= 70
    ) {
      lines.push("The connection has room to spare: the router answers right away and the internet comes back fast.");
    }
  }

  if ((inet?.loss ?? 0) > 0) {
    lines.push(
      inet.loss >= 20
        ? `The internet lost ${inet.loss}% of the probes. The signal can be strong and browsing can still fail in bursts.`
        : `The internet lost ${inet.loss}% of the probes in this cycle.`,
    );
  }
  if ((inet?.jitter ?? 0) >= 25) {
    lines.push("Latency is swinging. Calls and pages can stutter even when the average looks acceptable.");
  }
  if (wifi?.connected && wifi.signal != null && wifi.signal < 60) {
    lines.push("The Wi-Fi signal is low. Moving closer to the router, or a less crowded channel, usually helps.");
  }
  if (crowded >= 3 && wifi?.channel != null) {
    lines.push(`Channel ${wifi.channel} is shared with ${crowded} neighboring networks.`);
  }
  if (airtime != null && airtime >= 50) {
    lines.push(`The channel is busy ${airtime}% of the time. That holds speed down even with a strong signal.`);
  }
  if (saturated) {
    lines.push("Download is using most of the link. Everything else on the network feels it.");
  }
  if (lines.length === 0 && snapshot.probesReady) {
    lines.push("The router and the internet are in a middle band. The chart shows if that starts to swing.");
  }
  if (lines.length === 0) {
    lines.push("The first reading is still coming in. The ping takes a few seconds.");
  }
  return lines;
}
