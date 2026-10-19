/* web-fixtures.js — what the providers actually returned, on the day each web
 * example was written.
 *
 * A web skill's examples cannot be executed against the live web. The answer to
 * "who is the governor of Maryland" changes; Wikipedia rate-limits a burst of
 * requests with a 429; and a suite that fails when the world changes, or when a
 * public API is busy, is a suite people learn to ignore. So the examples run
 * against these recorded replies, which makes them a test of the SKILLS — do
 * they parse the reply, pick the right field, carry the source, refuse when
 * there is nothing — and not a test of the internet.
 *
 * What that does NOT prove is that the providers still work, or still answer in
 * this shape. `npm run webcheck` is the live check, and the Ledger says which of
 * the two you are reading.
 *
 * Re-recorded whenever the provider logic changes. These came from the running
 * proxy after the fallback moved from the REST summary endpoint (which truncated
 * before the answer) to the full opening section.
 */
export const FIXTURES_AS_OF = '2026-09-02';

export const WEB_FIXTURES = {
  "governor of Maryland": {
    "answer": "The governor of the State of Maryland is the head of government of Maryland, and is the commander-in-chief of the state's National Guard units. The governor is the highest-ranking official in the state and has a broad range of appointive powers in both the state and local governments, as specified by the Maryland Constitution (1867, and revisions/amendments). The current governor is Wes Moore, who has been in office since 2023.",
    "source": "https://en.wikipedia.org/wiki/Governor_of_Maryland",
    "results": [
      {
        "title": "Governor of Maryland",
        "snippet": "The governor of the State of Maryland is the head of government of Maryland, and is the co",
        "source": "https://en.wikipedia.org/wiki/Governor_of_Maryland"
      },
      {
        "title": "List of governors of Maryland",
        "snippet": "The governor of Maryland is the head of government of the U.S. state of Maryland and is th",
        "source": "https://en.wikipedia.org/wiki/List_of_governors_of_Maryland"
      }
    ]
  },
  "Ada Lovelace": {
    "answer": "Augusta Ada King, Countess of Lovelace (née Byron; 10 December 1815 – 27 November 1852), also known as Ada Lovelace, was an English mathematician and writer chiefly known for work on Charles Babbage's proposed mechanical general-purpose computer, the analytical engine. She was the first to recognise the machine had applications beyond pure calculation. Lovelace is often considered the first computer programmer. Lovelace was the only legitimate child of poet Lord Byron and reformer Anne Isabella Milbanke. Lord Byron separated from his wife a month after Ada was born, and died when she was eight. Although often ill in childhood, Lovelace pursued her studies assiduously. She married William King in 1835. King was a Baron, and was created Viscount Ockham and 1st Earl of Lovelace in 1838. The name Lovelace was chosen because Ada was descended from the extinct Baron Lovelaces. The title given to her husband thus made Ada the Countess of Lovelace. Lovelace's educational and social exploits brought her into contact with scientists such as Andrew Crosse, Charles Babbage, David Brewster, Charles Wheatstone and Michael Faraday, and the author Charles Dickens, contacts which she used to further her education. Lovelace described her approach as \"poetical science\" and herself as an \"Analyst (& Metaphysician)\".",
    "source": "https://en.wikipedia.org/wiki/Ada_Lovelace",
    "results": [
      {
        "title": "Ada Lovelace",
        "snippet": "Augusta Ada King, Countess of Lovelace (née Byron; 10 December 1815 – 27 November 1852), a",
        "source": "https://en.wikipedia.org/wiki/Ada_Lovelace"
      },
      {
        "title": "Ada Lovelace (microarchitecture)",
        "snippet": "Ada Lovelace, also referred to simply as Lovelace, is a graphics processing unit (GPU) mic",
        "source": "https://en.wikipedia.org/wiki/Ada_Lovelace_(microarchitecture)"
      }
    ]
  },
  "James Webb Space Telescope": {
    "answer": "The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared astronomy. It is the largest telescope in space, and is equipped with high-resolution and high-sensitivity instruments, allowing it to view objects too old, distant, or faint for the Hubble Space Telescope. This enables investigations across many fields of astronomy and cosmology, such as observation of the first stars and the formation of the first galaxies, and detailed atmospheric characterization of potentially habitable exoplanets. Despite Webb's mirror diameter being 2.7 times larger than that of the Hubble Space Telescope, it produces images of comparable resolution because it observes in the infrared spectrum, which has longer wavelengths than the Hubble's visible spectrum. The longer the wavelength the telescope is designed to observe, the larger the information-gathering surface (mirrors in the infrared spectrum or antenna area in the millimeter and radio ranges) required to achieve the desired resolution. The Webb was launched on 25 December 2021 on an Ariane 5 rocket from Kourou, French Guiana. In January 2022, it arrived at its destination, a solar orbit near the Sun–Earth L2 Lagrange point, about 1.5 million kilometers (930,000 mi) from Earth. The telescope's first image was released to the public on 11 July 2022. The U.S.",
    "source": "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
    "results": [
      {
        "title": "James Webb Space Telescope",
        "snippet": "The James Webb Space Telescope (JWST) is a space telescope designed to conduct infrared as",
        "source": "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope"
      },
      {
        "title": "James E. Webb",
        "snippet": "studies. In 2002, the Next Generation Space Telescope was renamed the James Webb Space Tel",
        "source": "https://en.wikipedia.org/wiki/James_E._Webb"
      }
    ]
  },
  "capital of Mongolia": {
    "answer": "Ulaanbaatar is the capital and largest city of Mongolia. It has a population of 1.79 million, and is the coldest capital city in the world by average yearly temperature. The municipality is located in north central Mongolia at an elevation of about 1,300 metres (4,300 ft) in a valley on the Tuul River. The city was founded in 1639 as a nomadic Buddhist monastic centre, changing location 29 times, and was permanently settled at its modern location in 1778. During its early years, as Örgöö (anglicized as Urga), it became Mongolia's preeminent religious centre and seat of the Jebtsundamba Khutuktu, the spiritual head of the Gelug lineage of Tibetan Buddhism in Mongolia. Following the regulation of Qing-Russian trade by the Treaty of Kyakhta in 1727, a caravan route between Beijing and Kyakhta opened up, along which the city was eventually settled. With the collapse of the Qing dynasty in 1911, the city was a focal point for independence efforts, leading to the proclamation of the Bogd Khanate in 1911 led by the 8th Jebtsundamba Khutuktu, or Bogd Khan, and again during the communist revolution of 1921. With the proclamation of the Mongolian People's Republic in 1924, the city was officially renamed Ulaanbaatar and declared the country's capital. Modern urban planning began in the 1950s, with most of the old ger districts replaced by Soviet-style flats.",
    "source": "https://en.wikipedia.org/wiki/Ulaanbaatar",
    "results": [
      {
        "title": "Ulaanbaatar",
        "snippet": "Ulaanbaatar is the capital and largest city of Mongolia. It has a population of 1.79 milli",
        "source": "https://en.wikipedia.org/wiki/Ulaanbaatar"
      },
      {
        "title": "Capital punishment in Mongolia",
        "snippet": "Capital punishment has been abolished in Mongolia since 2016, following a previous eight-y",
        "source": "https://en.wikipedia.org/wiki/Capital_punishment_in_Mongolia"
      }
    ]
  },
  "Hedy Lamarr": {
    "answer": "Hedy Lamarr (; born Hedwig Eva Maria Kiesler; November 9, 1914 – January 19, 2000) was an Austrian and American actress and inventor. Regarded as a successful film star, she also co-invented a radio guidance system during World War II. After a brief early film career in Czechoslovakia, including the controversial erotic romantic drama Ecstasy (1933), she fled from her first husband, Friedrich Mandl, and secretly moved to Paris. Traveling to London, she met Louis B. Mayer, who offered her a film contract in Hollywood. Lamarr became a film star with her performance in the romantic drama Algiers (1938). She achieved further success with the Western Boom Town (1940) and the drama White Cargo (1942). Lamarr's most successful film was the religious epic Samson and Delilah (1949). She also acted on television before the release of her final film in 1958. She was honored with a star on the Hollywood Walk of Fame in 1960. At the beginning of World War II, along with composer George Antheil, Lamarr co-invented a radio guidance system for Allied torpedoes that used spread spectrum and frequency hopping technology to defeat the threat of radio jamming by the Axis powers. This approach, conceptualized as a \"Secret Communication System\", was intended to provide secure, jam-resistant communication for weapon guidance by spreading the signal across multiple frequencies.",
    "source": "https://en.wikipedia.org/wiki/Hedy_Lamarr",
    "results": [
      {
        "title": "Hedy Lamarr",
        "snippet": "Hedy Lamarr (/ˈhɛdi/; born Hedwig Eva Maria Kiesler; November 9, 1914 – January 19, 2000) ",
        "source": "https://en.wikipedia.org/wiki/Hedy_Lamarr"
      },
      {
        "title": "Bombshell: The Hedy Lamarr Story",
        "snippet": "Bombshell: The Hedy Lamarr Story (referred to onscreen as simply Bombshell) is a 2017 Amer",
        "source": "https://en.wikipedia.org/wiki/Bombshell:_The_Hedy_Lamarr_Story"
      }
    ]
  },
  "Voyager 1": {
    "answer": "Voyager 1 is a space probe launched by NASA on September 5, 1977, as part of the Voyager program, to study the outer Solar System and the interstellar space beyond the Sun's heliosphere. It was launched 16 days after its twin, Voyager 2. It communicates through the NASA Deep Space Network (DSN) to receive routine commands and to transmit data to Earth. Real-time distance and velocity data are provided by NASA and JPL. At a distance of 171.19 AU (25.6 billion km; 15.9 billion mi) as of August 2026, it is the most distant human-made object from Earth. Voyager 1 is projected to reach a distance of one light day from Earth in November 2026. The probe made flybys of Jupiter, Saturn, and Saturn's largest moon, Titan. NASA had a choice of either conducting a Pluto or Titan flyby. Exploration of Titan took priority because it was known to have a substantial atmosphere. Voyager 1 studied the weather, magnetic fields, and rings of the two gas giants and was the first probe to provide detailed images of their moons. As part of the Voyager program and like its sister craft Voyager 2, the spacecraft's extended mission is to locate and study the regions and boundaries of the outer heliosphere and to begin exploring the interstellar medium. Voyager 1 crossed the heliopause and entered interstellar space on August 25, 2012, making it the first spacecraft to do so.",
    "source": "https://en.wikipedia.org/wiki/Voyager_1",
    "results": [
      {
        "title": "Voyager 1",
        "snippet": "Voyager 1 is a space probe launched by NASA on September 5, 1977, as part of the Voyager p",
        "source": "https://en.wikipedia.org/wiki/Voyager_1"
      },
      {
        "title": "Voyager 1 (disambiguation)",
        "snippet": "Voyager 1 is a space probe launched by NASA in 1977. Voyager 1 may also refer to: Voyager ",
        "source": "https://en.wikipedia.org/wiki/Voyager_1_(disambiguation)"
      }
    ]
  },
  "qwertyuiop asdfghjkl": {
    "answer": null,
    "source": null,
    "results": []
  },
  "Antikythera mechanism": {
    "answer": "The Antikythera mechanism ( AN-tik-ih-THEER-ə, US also AN-ty-kih-) is an ancient Greek hand-powered orrery (model of the Solar System) built in the 2nd century BC and discovered in 1901. It is the oldest known example of an analogue computer. It could be used to predict astronomical positions and eclipses decades in advance. It could also be used to track the four-year cycle of athletic games similar to an olympiad, the cycle of the ancient Olympic Games. The artefact was among wreckage retrieved from a shipwreck off the coast of the Greek island Antikythera in 1901. In 1902, during a visit to the National Archaeological Museum in Athens, it was noticed by Greek politician Spyridon Stais as containing a gear, prompting the first study of the fragment by his cousin, Valerios Stais, the museum director. The device, housed in the remains of a wooden-framed case of (uncertain) overall size 34 cm × 18 cm × 9 cm (13.4 in × 7.1 in × 3.5 in), was found as one lump, later separated into three main fragments which are now divided into 82 separate fragments after conservation efforts. Four of these fragments contain gears, while inscriptions are found on many others. The largest gear is about 13 cm (5 in) in diameter and originally had 223 teeth.",
    "source": "https://en.wikipedia.org/wiki/Antikythera_mechanism",
    "results": [
      {
        "title": "Antikythera mechanism",
        "snippet": "The Antikythera mechanism (/ˌæntɪkɪˈθɪərə/ AN-tik-ih-THEER-ə, US also /ˌæntaɪkɪˈ-/ AN-ty-k",
        "source": "https://en.wikipedia.org/wiki/Antikythera_mechanism"
      },
      {
        "title": "Antikythera",
        "snippet": "being the location of the discovery of the Antikythera mechanism and for the historical Ro",
        "source": "https://en.wikipedia.org/wiki/Antikythera"
      }
    ]
  }
};
