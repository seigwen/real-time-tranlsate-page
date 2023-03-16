"use strict";

/**
 * This mark cannot contain words, like <customskipword>12</customskipword>34
 *
 * Google will reorder as <customskipword>1234</customskipword>
 *
 * Under certain circumstances，Google broken the translation, returned startMark0 in some cases
 * */
const startMark = "@%";
const endMark = "#$";
const startMark0 = "@ %";
const endMark0 = "# $";

let currentIndex;
let compressionMap;

/**
 *  Convert matching keywords to a string of special numbers to skip translation before sending to the translation engine.
 *
 *  For English words, ignore case when matching.
 *
 *  But for the word "app" , We don't want to "Happy" also matched.
 *
 *  So we match only isolated words, by checking the two characters before and after the keyword.
 *
 *  But this will also cause this method to not work for Chinese, Burmese and other languages without spaces.
 * */
function filterKeywordsInText(textContext) {
  // a map
  let customDictionary = twpConfig.get("customDictionary");
  if (customDictionary.size > 0) {
    // reordering the map, we want to match the keyword "Spring Boot" first then the keyword "Spring"
    customDictionary = new Map(
      [...customDictionary.entries()].sort(
        (a, b) => String(b[0]).length - String(a[0]).length
      )
    );
    for (let keyWord of customDictionary.keys()) {
      while (true) {
        let index = textContext.toLowerCase().indexOf(keyWord);
        if (index === -1) {
          break;
        } else {
          textContext = removeExtraDelimiter(textContext);
          let previousIndex = index - 1;
          let nextIndex = index + keyWord.length;
          let previousChar =
            previousIndex === -1 ? "\n" : textContext.charAt(previousIndex);
          let nextChar =
            nextIndex === textContext.length
              ? "\n"
              : textContext.charAt(nextIndex);
          let placeholderText = "";
          let keyWordWithCase = textContext.substring(
            index,
            index + keyWord.length
          );
          if (
            isPunctuationOrDelimiter(previousChar) &&
            isPunctuationOrDelimiter(nextChar)
          ) {
            placeholderText =
              startMark + handleHitKeywords(keyWordWithCase, true) + endMark;
          } else {
            placeholderText = "#n%o#";
            for (let c of Array.from(keyWordWithCase)) {
              placeholderText += c;
              placeholderText += "#n%o#";
            }
          }
          let frontPart = textContext.substring(0, index);
          let backPart = textContext.substring(index + keyWord.length);
          textContext = frontPart + placeholderText + backPart;
        }
      }
      textContext = textContext.replaceAll("#n%o#", "");
    }
  }
  return textContext;
}

/**
 *  handle the keywords in translatedText, replace it if there is a custom replacement value.
 *
 *  When encountering Google Translate reordering, the original text contains our mark, etc. , we will catch these exceptions and call the text translation method to retranslate this section.
 */
async function handleCustomWords(
  translated,
  originalText,
  currentPageTranslatorService,
  currentTargetLanguage
) {
  try {
    const customDictionary = twpConfig.get("customDictionary");
    if (customDictionary.size > 0) {
      translated = removeExtraDelimiter(translated);
      translated = translated.replaceAll(startMark0, startMark);
      translated = translated.replaceAll(endMark0, endMark);

      while (true) {
        let startIndex = translated.indexOf(startMark);
        let endIndex = translated.indexOf(endMark);
        if (startIndex === -1 && endIndex === -1) {
          break;
        } else {
          let placeholderText = translated.substring(
            startIndex + startMark.length,
            endIndex
          );
          // At this point placeholderText is actually currentIndex , the real value is in compressionMap
          let keyWord = handleHitKeywords(placeholderText, false);
          if (keyWord === "undefined") {
            throw new Error("undefined");
          }
          let frontPart = translated.substring(0, startIndex);
          let backPart = translated.substring(endIndex + endMark.length);
          let customValue = customDictionary.get(keyWord.toLowerCase());
          customValue = customValue === "" ? keyWord : customValue;
          // Highlight custom words, make it have a space before and after it
          frontPart = isPunctuationOrDelimiter(
            frontPart.charAt(frontPart.length - 1)
          )
            ? frontPart
            : frontPart + " ";
          backPart = isPunctuationOrDelimiter(backPart.charAt(0))
            ? backPart
            : " " + backPart;
          translated = frontPart + customValue + backPart;
        }
      }
    }
  } catch (e) {
    return await backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentTargetLanguage,
      originalText
    );
  }

  return translated;
}

/**
 * 
 * @param {*} value 
 * @param {*} mode True : Store the keyword in the Map and return the index; False : Extract keywords by index
 * @returns 
 */
function handleHitKeywords(value, mode) {
  if (mode) {
    if (currentIndex === undefined) {
      currentIndex = 1;
      compressionMap = new Map();
      compressionMap.set(currentIndex, value);
    } else {
      compressionMap.set(++currentIndex, value);
    }
    return String(currentIndex);
  } else {
    return String(compressionMap.get(Number(value)));
  }
}

/**
 * 是否标点或分隔符
 * any kind of punctuation character (including international e.g. Chinese and Spanish punctuation), and spaces, newlines
 *
 * source: https://github.com/slevithan/xregexp/blob/41f4cd3fc0a8540c3c71969a0f81d1f00e9056a9/src/addons/unicode/unicode-categories.js#L142
 *
 * note: XRegExp unicode output taken from http://jsbin.com/uFiNeDOn/3/edit?js,console (see chrome console.log), then converted back to JS escaped unicode here http://rishida.net/tools/conversion/, then tested on http://regexpal.com/
 *
 * suggested by: https://stackoverflow.com/a/7578937
 *
 * added: extra characters like "$", "\uFFE5" [yen symbol], "^", "+", "=" which are not consider punctuation in the XRegExp regex (they are currency or mathmatical characters)
 *
 * added: Chinese Punctuation: \u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e
 *
 * added: special html space symbol: &nbsp; &ensp; &emsp; &thinsp; &zwnj; &zwj; -> \u00A0|\u2002|\u2003|\u2009|\u200C|\u200D
 * @see https://stackoverflow.com/a/21396529/19616126
 * */
function isPunctuationOrDelimiter(str) {
  if (typeof str !== "string") return false;
  if (str === "\n" || str === " ") return true;
  const regex =
    /[\$\uFFE5\^\+=`~<>{}\[\]|\u00A0|\u2002|\u2003|\u2009|\u200C|\u200D|\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g;
  return regex.test(str);
}

/**
 * Remove useless newlines, spaces inside, which may affect our semantics
 * */
function removeExtraDelimiter(textContext) {
  textContext = textContext.replaceAll("\n", " ");
  textContext = textContext.replace(/  +/g, " ");
  return textContext;
}

/**
 * 请求后台翻译节点 
 *  
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} sourceArray2d 
 * @param {*} dontSortResults 
 * @returns 
 */
function backgroundTranslateHTML(
  translationService,
  targetLanguage,
  sourceArray2d,
  dontSortResults
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateHTML",
        translationService,
        targetLanguage,
        sourceArray2d,
        dontSortResults,
      },
      (response) => {
        resolve(response);
      }
    );
  });
}

/**
 * 请求后台翻译属性文本
 * 
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} sourceArray 
 * @returns 
 */
function backgroundTranslateText(
  translationService,
  targetLanguage,
  sourceArray
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateText",
        translationService,
        targetLanguage,
        sourceArray,
      },
      (response) => {
        resolve(response);
      }
    );
  });
}

/**
 * 请求后台翻译单串文字
 * 
 * @param {*} translationService 
 * @param {*} targetLanguage 
 * @param {*} source a string to be translated
 * @returns 
 */
function backgroundTranslateSingleText(
  translationService,
  targetLanguage,
  source
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateSingleText",
        translationService,
        targetLanguage,
        source,
      },
      (response) => {
        resolve(response);
      }
    );
  });
}

var pageTranslator = {};

/**
 * 获取tab主机名
 * @returns 
 */
function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) =>
      resolve(result)
    )
  );
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  const tabHostName = _[1];
  // inline文本
  const htmlTagsInlineText = [
    "#text",
    "a",
    "abbr",
    "acronym",
    "b",
    "bdo",
    "big",
    "cite",
    "dfn",
    "em",
    "i",
    "label",
    "q",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "u",
    "tt",
    "var",
  ];
  const htmlTagsInlineIgnore = ["br", "code", "kbd", "wbr"]; // and input if type is submit or button, and <pre> depending on settings
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "svg"];

  if (twpConfig.get("translateTag_pre") !== "yes") {
    htmlTagsInlineIgnore.push("pre");
  }

  // 监听配置变更, 实时反映到内存变量htmlTagsInlineIgnore中
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
      // 是否翻译pre标签的内容
      case "translateTag_pre":
        const index = htmlTagsInlineIgnore.indexOf("pre");
        if (index !== -1) {
          htmlTagsInlineIgnore.splice(index, 1);
        }
        if (newvalue !== "yes") {
          htmlTagsInlineIgnore.push("pre");
        }
        break;
    }
  });

  //TODO FOO
  if (
    twpConfig.get("useOldPopup") == "yes" ||
    twpConfig.get("popupPanelSection") <= 1
  ) {
    twpConfig.set("targetLanguage", twpConfig.get("targetLanguages")[0]);
  }

  // Pieces are a set of nodes separated by inline tags that form a sentence or paragraph.
  let piecesToTranslate = [];
  let originalTabLanguage = "und";
  let currentPageLanguage = "und";
  // 页面语言状态(原始/已翻译)
  let pageLanguageState = "original";
  // 当前目标语言. 一开始时,改值从config去除, 用户使用中更改目标语言时, currentTargetLanguage随之更改
  let currentTargetLanguage = twpConfig.get("targetLanguage");
  // 翻译服务引擎(google/yandex)
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  // 
  let dontSortResults =
    twpConfig.get("dontSortResults") == "yes" ? true : false;
  let fooCount = 0;

  let originalPageTitle;
  // 需要翻译的attributes(如placehodler等)
  let attributesToTranslate = [];
  // 定时翻译新节点(用setInterval定时)
  let translateNewNodesTimerHandler;
  // 新节点(mutationObserver添加的节点)
  let newNodes = [];
  // 新节点(mutationObserver删除的节点)
  let removedNodes = [];

  let nodesToRestore = [];

  /**
   * 把新建节点的信息推入piecesToTranslate数组
   */
  function translateNewNodes() {
    try {
      newNodes.forEach((nn) => {
        if (removedNodes.indexOf(nn) != -1) return;

        // 从每个new node中取得pieces
        let newPiecesToTranslate = getPiecesToTranslate(nn);

        // 检查piecesToTranslate数组里是否已包含新取得的piece,如果没有包含,则push到piecesToTranslate数组
        for (const i in newPiecesToTranslate) {
          const newNodes = newPiecesToTranslate[i].nodes;
          let finded = false;

          for (const ntt of piecesToTranslate) {
            if (ntt.nodes.some((n1) => newNodes.some((n2) => n1 === n2))) {
              finded = true;
            }
          }

          if (!finded) {
            piecesToTranslate.push(newPiecesToTranslate[i]);
          }
        }
      });
    } catch (e) {
      console.error(e);
    } finally {
      newNodes = [];
      removedNodes = [];
    }
  }

  // 节点变更监听,新节点放入newNodes数组,删除节点放入removedNodes数组
  const mutationObserver = new MutationObserver(function (mutations) {
    const piecesToTranslate = [];

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((addedNode) => {
        const nodeName = addedNode.nodeName.toLowerCase();
        if (htmlTagsNoTranslate.indexOf(nodeName) == -1) {
          if (htmlTagsInlineText.indexOf(nodeName) == -1) {
            if (htmlTagsInlineIgnore.indexOf(nodeName) == -1) {
              piecesToTranslate.push(addedNode);
            }
          }
        }
      });

      mutation.removedNodes.forEach((removedNode) => {
        removedNodes.push(removedNode);
      });
    });

    piecesToTranslate.forEach((ptt) => {
      if (newNodes.indexOf(ptt) == -1) {
        newNodes.push(ptt);
      }
    });
  });

  /**
   * 监听节点变更, 每两秒把新节点推入piecesToTranslate数组
   */
  function enableMutatinObserver() {
    disableMutatinObserver();

    if (twpConfig.get("translateDynamicallyCreatedContent") == "yes") {
      // 每两秒把新节点推入piecesToTranslate数组
      translateNewNodesTimerHandler = setInterval(translateNewNodes, 2000);
      // 监听节点更新
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  /**
   * 取消监听节点变更; 取消定时翻译器
   */
  function disableMutatinObserver() {
    clearInterval(translateNewNodesTimerHandler);
    newNodes = [];
    removedNodes = [];
    mutationObserver.disconnect();
    mutationObserver.takeRecords();
  }

  let pageIsVisible = document.visibilityState == "visible";
  // this causes parts of youtube not to be translated
  // new IntersectionObserver(entries => {
  //         if (entries[0].isIntersecting && document.visibilityState == "visible") {
  //             pageIsVisible = true
  //         } else {
  //             pageIsVisible = false
  //         }

  //         if (pageIsVisible && pageLanguageState === "translated") {
  //             enableMutatinObserver()
  //         } else {
  //             disableMutatinObserver()
  //         }
  //     }, {
  //         root: null
  //     })
  //     .observe(document.body)

  /**
   * 监视页面可视性. 页面可视时开启mutationObserver和定时翻译器,否则关闭mutationObserver和定时翻译器
   */
  const handleVisibilityChange = function () {
    if (document.visibilityState == "visible") {
      pageIsVisible = true;
    } else {
      pageIsVisible = false;
    }

    if (pageIsVisible && pageLanguageState === "translated") {
      enableMutatinObserver();
    } else {
      disableMutatinObserver();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange, false);

  /**
   * 获取传入的节点的树(包括节点自身和它的所有后代节点)的所有需要翻译的节点的信息
   * 原理: 通过遍历,获取所有元素的信息,每个块级元素的信息放入一个对象,
   * 然后把块级元素下面的inline子元素放入对象的nodes属性,然后将该对象推入此一维数组,最后返回此数组
   * @param {*} root 
   * @returns {array} piecesToTranslate, 一维数组, 数组元素格式如下:
   *  {
        isTranslated: boolean,
        parentElement: node,
        topElement: node,
        bottomElement: node,
        nodes: [],
      },
   */
  function getPiecesToTranslate(root = document.documentElement) {
    const piecesToTranslate = [
      {
        isTranslated: false,
        parentElement: null,
        topElement: null,
        bottomElement: null,
        nodes: [],
      },
    ];
    let index = 0;
    let currentParagraphSize = 0;

    /**
     * 获取节点的树的全部节点(即节点和后代节点). 过程为递归调用. 深度优先, 先序遍历
     * @param {*} node 
     * @param {*} lastHTMLElement 
     * @param {*} lastSelectOrDataListElement 
     * @returns 
     */
    const getAllNodes = function (
      node,
      lastHTMLElement = null,
      lastSelectOrDataListElement = null
    ) {
      /**
       * nodeType:
       *  
        1	Node.ELEMENT_NODE                 一个 元素 节点，例如 <p> 和 <div>。
        2	Node.ATTRIBUTE_NODE	              元素 的耦合 属性。
        3	Node.TEXT_NODE                    Element或者 Attr 中实际的 文字
        4	Node.CDATA_SECTION_NODE           一个 CDATASection，例如 <!CDATA[[ … ]]>。
        7	Node.PROCESSING_INSTRUCTION_NODE	一个用于 XML 文档的 ProcessingInstruction (en-US) ，例如 <?xml-stylesheet ... ?> 声明。
        8	Node.COMMENT_NODE	                一个 Comment 节点。
        9	Node.DOCUMENT_NODE	              一个 Document 节点。
        10 Node.DOCUMENT_TYPE_NODE	        描述文档类型的 DocumentType 节点。例如 <!DOCTYPE html> 就是用于 HTML5 的。
        11 Node.DOCUMENT_FRAGMENT_NODE		  一个 DocumentFragment 节点
       */

      // element node or fragment node, 这两种节点具有子节点
      if (node.nodeType == 1 || node.nodeType == 11) {
        // fragment node
        if (node.nodeType == 11) {
          lastHTMLElement = node.host;
          lastSelectOrDataListElement = null;
        }
        // element node
        else if (node.nodeType == 1) {
          lastHTMLElement = node;
          const nodeName = node.nodeName.toLowerCase();

          if (nodeName === "select" || nodeName === "datalist")
            lastSelectOrDataListElement = node;

          // 如果元素是需要忽略翻译或指定不翻译的元素, 则推入piecesToTranslate数组,并退出getAllNodes函数
          if (
            htmlTagsInlineIgnore.indexOf(nodeName) !== -1 ||
            htmlTagsNoTranslate.indexOf(nodeName) !== -1 ||
            node.classList.contains("notranslate") ||
            node.getAttribute("translate") === "no" ||
            node.isContentEditable ||
            node.classList.contains("material-icons") ||
            node.classList.contains("material-symbols-outlined")
          ) {
            if (piecesToTranslate[index].nodes.length > 0) {
              currentParagraphSize = 0;
              piecesToTranslate[index].bottomElement = lastHTMLElement;
              // 把一个初始对象推入piecesToTranslate数组
              piecesToTranslate.push({
                isTranslated: false,
                parentElement: null,
                topElement: null,
                bottomElement: null,
                nodes: [],
              });
              index++;
            }
            return;
          }
        }

        /**
         * 获取节点的全部子节点
         * 
         * @param {*} childNodes 
         */
        function getAllChilds(childNodes) {
          Array.from(childNodes).forEach((_node) => {
            const nodeName = _node.nodeName.toLowerCase();

            // element node
            if (_node.nodeType == 1) {
              lastHTMLElement = _node;
              if (nodeName === "select" || nodeName === "datalist")
                lastSelectOrDataListElement = _node;
            }

            // 如果节点是block元素
            if (htmlTagsInlineText.indexOf(nodeName) == -1) {
              // 如果
              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                // 把一个初始对象推入piecesToTranslate数组
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }

              // 获取该子节点的所有子节点
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);

              // 
              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                // 把一个初始对象推入piecesToTranslate数组
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }
            }
            // 如果节点是inline元素,则获取该子节点的所有子节点
            else {
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);
            }
          });
        }
        getAllChilds(node.childNodes);

        if (!piecesToTranslate[index].bottomElement) {
          piecesToTranslate[index].bottomElement = node;
        }
        if (node.shadowRoot) {
          getAllChilds(node.shadowRoot.childNodes);
          if (!piecesToTranslate[index].bottomElement) {
            piecesToTranslate[index].bottomElement = node;
          }
        }
      }
      // 文本节点
      else if (node.nodeType == 3) {
        // 文本长度大于0
        if (node.textContent.trim().length > 0) {
          if (!piecesToTranslate[index].parentElement) {
            if (
              node &&
              node.parentNode &&
              node.parentNode.nodeName.toLowerCase() === "option" &&
              lastSelectOrDataListElement
            ) {
              piecesToTranslate[index].parentElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].bottomElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].topElement = lastSelectOrDataListElement;
            } else {
              let temp = node.parentNode;
              const nodeName = temp.nodeName.toLowerCase();
              while (
                temp &&
                temp != root &&
                (htmlTagsInlineText.indexOf(nodeName) != -1 ||
                  htmlTagsInlineIgnore.indexOf(nodeName) != -1)
              ) {
                temp = temp.parentNode;
              }
              if (temp && temp.nodeType === 11) {
                temp = temp.host;
              }
              piecesToTranslate[index].parentElement = temp;
            }
          }
          if (!piecesToTranslate[index].topElement) {
            piecesToTranslate[index].topElement = lastHTMLElement;
          }
          if (currentParagraphSize > 1000) {
            currentParagraphSize = 0;
            piecesToTranslate[index].bottomElement = lastHTMLElement;
            const pieceInfo = {
              isTranslated: false,
              parentElement: null,
              topElement: lastHTMLElement,
              bottomElement: null,
              nodes: [],
            };
            pieceInfo.parentElement = piecesToTranslate[index].parentElement;
            piecesToTranslate.push(pieceInfo);
            index++;
          }
          currentParagraphSize += node.textContent.length;
          // 把文本节点推入
          piecesToTranslate[index].nodes.push(node);
          piecesToTranslate[index].bottomElement = null;
        }
      }
    };
    getAllNodes(root);

    if (
      piecesToTranslate.length > 0 &&
      piecesToTranslate[piecesToTranslate.length - 1].nodes.length == 0
    ) {
      piecesToTranslate.pop();
    }

    return piecesToTranslate;
  }

  /**
   * 获取传入的节点的树(包括节点自身和它的所有后代节点)的所有需要翻译的属性的信息
   * 
   * @param {*} root 
   * @returns {array} attributesToTranslate, 一维数组(通过遍历,获取所有属性的信息,每个属性的信息放入一个对象,然后将该对象推入此一维数组), 数组元素格式如下:
   *  {
        node: e,
        original: "Reset",
        attrName: "value",
      }
   */
  function getAttributesToTranslate(root = document.body) {
    const attributesToTranslate = [];

    const placeholdersElements = root.querySelectorAll(
      "input[placeholder], textarea[placeholder]"
    );
    const altElements = root.querySelectorAll(
      'area[alt], img[alt], input[type="image"][alt]'
    );
    const valueElements = root.querySelectorAll(
      'input[type="button"], input[type="submit"], input[type="reset"]'
    );
    const titleElements = root.querySelectorAll("body [title]");

    function hasNoTranslate(elem) {
      if (
        elem &&
        (elem.classList.contains("notranslate") ||
          elem.getAttribute("translate") === "no")
      ) {
        return true;
      }
    }

    placeholdersElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("placeholder");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "placeholder",
        });
      }
    });

    altElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("alt");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "alt",
        });
      }
    });

    valueElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("value");
      if (e.type == "submit" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Submit Query",
          attrName: "value",
        });
      } else if (e.type == "reset" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Reset",
          attrName: "value",
        });
      } else if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "value",
        });
      }
    });

    titleElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("title");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "title",
        });
      }
    });

    return attributesToTranslate;
  }

  /**
   * 用font标签包裹文本节点
   * @param {*} node 文本节点
   * @returns 
   */
  // encapsulating the text makes the video disappear 
  // when using a function like Pai.removeChild(child) 
  // an error can be generated when encapsulating
  function encapsulateTextNode(node) {
    const fontNode = document.createElement("font");
    fontNode.setAttribute("style", "vertical-align: inherit;");
    fontNode.textContent = node.textContent;

    node.replaceWith(fontNode);

    return fontNode;
  }

  /**
   * 把节点文本替换为翻译后的文本
   * 
   * @param {*} piecesToTranslateNow 要翻译的节点
   * @param {*} results 翻译结果. 结构为二维数组.
   */
  function translateResults(piecesToTranslateNow, results) {
    if (dontSortResults) {
      for (let i = 0; i < results.length; i++) {
        for (let j = 0; j < results[i].length; j++) {
          if (piecesToTranslateNow[i].nodes[j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            let translated = results[i][j] + " ";
            // In some case, results items count is over original node count
            // Rest results append to last node
            if (
              piecesToTranslateNow[i].nodes.length - 1 === j &&
              results[i].length > j
            ) {
              const restResults = results[i].slice(j + 1);
              translated += restResults.join(" ");
            }

            // ??
            const originalTextNode = nodes[j];
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
            };

            // 把旧节点存储起来, 用于恢复
            nodesToRestore.push(toRestore);

            // 处理自定义翻译
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
              // 把翻译结果放入节点
              nodes[j].textContent = results;
              toRestore.translatedText = results;
            });
          }
        }
      }
    } else {
      for (const i in piecesToTranslateNow) {
        for (const j in piecesToTranslateNow[i].nodes) {
          if (results[i][j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            const translated = results[i][j] + " ";

            const originalTextNode = nodes[j];
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
            };

            // 把旧节点存储起来, 用于恢复
            nodesToRestore.push(toRestore);

            // 处理自定义翻译
            handleCustomWords(
              translated,
              nodes[j].textContent,
              currentPageTranslatorService,
              currentTargetLanguage
            ).then((results) => {
              // 把翻译结果放入节点
              nodes[j].textContent = results;
              // 把自定义翻译结果更新到toRestore.translatedText
              toRestore.translatedText = results;
            });
          }
        }
      }
    }
    mutationObserver.takeRecords();
  }

  /**
   * 把属性文本替换为翻译后的属性文本
   * @param {*} attributesToTranslateNow 
   * @param {*} results 
   */
  function translateAttributes(attributesToTranslateNow, results) {
    for (const i in attributesToTranslateNow) {
      const ati = attributesToTranslateNow[i];
      ati.node.setAttribute(ati.attrName, results[i]);
    }
  }

  /**
   * 每600毫秒, 在piecesToTranslate数组和attributesToTranslate数组找到那些进入了屏幕可视区域的节点, 进行翻译
   */
  function translateDynamically() {
    try {
      if (piecesToTranslate && pageIsVisible) {
        (function () {
          const innerHeight = window.innerHeight;

          /**
           * 判断元素是否完全在屏幕
           * @param {*} element 
           * @returns {boolean}
           */
          function isInScreen(element) {
            const rect = element.getBoundingClientRect();
            if (
              (rect.top > 0 && rect.top <= innerHeight) ||
              (rect.bottom > 0 && rect.bottom <= innerHeight)
            ) {
              return true;
            }
            return false;
          }

          /**
           * 判断元素顶部是否在屏幕显示
           * @param {*} element 
           * @returns {boolean}
           */
          function topIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.top > 0 && rect.top <= innerHeight) {
              return true;
            }
            return false;
          }

          /**
           * 判断元素底部是否在屏幕显示
           * @param {*} element 
           * @returns {boolean}
           */
          function bottomIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.bottom > 0 && rect.bottom <= innerHeight) {
              return true;
            }
            return false;
          }

          const currentFooCount = fooCount;

          // 从piecesToTranslate数组中选择那些进入了屏幕可视区域的元素,放入piecesToTranslateNow数组中
          const piecesToTranslateNow = [];
          piecesToTranslate.forEach((ptt) => {
            if (!ptt.isTranslated) {
              if (
                bottomIsInScreen(ptt.topElement) ||
                topIsInScreen(ptt.bottomElement)
              ) {
                ptt.isTranslated = true;
                piecesToTranslateNow.push(ptt);
              }
            }
          });

          // 从attributesToTranslate数组中选择那些进入了屏幕可视区域的元素,放入attributesToTranslateNow数组中
          const attributesToTranslateNow = [];
          attributesToTranslate.forEach((ati) => {
            if (!ati.isTranslated) {
              if (isInScreen(ati.node)) {
                ati.isTranslated = true;
                attributesToTranslateNow.push(ati);
              }
            }
          });

          if (piecesToTranslateNow.length > 0) {
            // 翻译节点列表
            backgroundTranslateHTML(
              currentPageTranslatorService,
              currentTargetLanguage,
              piecesToTranslateNow.map((ptt) =>
                ptt.nodes.map((node) => filterKeywordsInText(node.textContent))
              ),
              dontSortResults
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                console.log("piecesToTranslateNow",piecesToTranslateNow)
                console.log("translated results:", results)

                // 把节点文本替换为翻译后的节点文本
                translateResults(piecesToTranslateNow, results);
              }
            });
          }

          if (attributesToTranslateNow.length > 0) {
            // 翻译属性列表
            backgroundTranslateText(
              currentPageTranslatorService,
              currentTargetLanguage,
              attributesToTranslateNow.map((ati) => ati.original)
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                // 把属性文本替换为翻译后的属性文本
                translateAttributes(attributesToTranslateNow, results);
              }
            });
          }
        })();
      }
    } catch (e) {
      console.error(e);
    }
    setTimeout(translateDynamically, 600);
  }

  translateDynamically();

  function translatePageTitle() {
    const title = document.querySelector("title");
    if (
      title &&
      (title.classList.contains("notranslate") ||
        title.getAttribute("translate") === "no")
    ) {
      return;
    }
    if (document.title.trim().length < 1) return;
    originalPageTitle = document.title;

    backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentTargetLanguage,
      originalPageTitle
    ).then((result) => {
      if (result) {
        document.title = result;
      }
    });
  }

  const pageLanguageStateObservers = [];

  pageTranslator.onPageLanguageStateChange = function (callback) {
    pageLanguageStateObservers.push(callback);
  };

  /**
   * 翻译整个页面
   * @param {*} targetLanguage 
   */
  pageTranslator.translatePage = function (targetLanguage) {
    fooCount++;
    // 恢复原来页面
    pageTranslator.restorePage();
    // 允许显示原文字
    showOriginal.enable();
    // 删除错误翻译
    chrome.runtime.sendMessage({ action: "removeTranslationsWithError" });

    dontSortResults = twpConfig.get("dontSortResults") == "yes" ? true : false;

    if (targetLanguage) {
      currentTargetLanguage = targetLanguage;
    }

    // 获取所有要翻译的节点的信息列表(一维数组)
    piecesToTranslate = getPiecesToTranslate();
    console.log("piecesToTranslate", piecesToTranslate)

    // 获取所有要翻译的属性的信息列表(一维数组)
    attributesToTranslate = getAttributesToTranslate();
    console.log("attributesToTranslate", attributesToTranslate)

    pageLanguageState = "translated";
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState,
    });
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = currentTargetLanguage;

    // 翻译标题
    translatePageTitle();

    // 监听节点变更
    enableMutatinObserver();

    // 翻译节点和属性(带定时器setTimeout)
    translateDynamically();
  };

  // 恢复原始页面
  pageTranslator.restorePage = function () {
    fooCount++;
    piecesToTranslate = [];

    // 禁止显示原文字(因为已经是原始页面了)
    showOriginal.disable();

    // 禁止监听节点变化
    disableMutatinObserver();

    pageLanguageState = "original";
    chrome.runtime.sendMessage({
      action: "setPageLanguageState",
      pageLanguageState,
    });
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = originalTabLanguage;

    if (originalPageTitle) {
      document.title = originalPageTitle;
    }
    originalPageTitle = null;

    for (const ntr of nodesToRestore) {
      if (ntr.node === ntr.original) {
        if (ntr.node.textContent === ntr.translatedText) {
          ntr.node.textContent = ntr.originalText;
        }
      } else {
        // 把现元素替换为原始元素
        ntr.node.replaceWith(ntr.original);
      }
    }
    nodesToRestore = [];

    //TODO do not restore attributes that have been modified
    for (const ati of attributesToTranslate) {
      if (ati.isTranslated) {
        ati.node.setAttribute(ati.attrName, ati.original);
      }
    }
    attributesToTranslate = [];
  };

  /**
   * 切换翻译服务
   */
  pageTranslator.swapTranslationService = function () {
    if (currentPageTranslatorService === "google") {
      currentPageTranslatorService = "yandex";
    } else {
      currentPageTranslatorService = "google";
    }
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage();
    }
  };

  let alreadyGotTheLanguage = false;
  const observers = [];

  pageTranslator.onGetOriginalTabLanguage = function (callback) {
    if (alreadyGotTheLanguage) {
      callback(originalTabLanguage);
    } else {
      observers.push(callback);
    }
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translatePage") {
      if (request.targetLanguage === "original") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage(request.targetLanguage);
      }
    } else if (request.action === "restorePage") {
      pageTranslator.restorePage();
    } else if (request.action === "getOriginalTabLanguage") {
      pageTranslator.onGetOriginalTabLanguage(function () {
        sendResponse(originalTabLanguage);
      });
      return true;
    } else if (request.action === "getCurrentPageLanguage") {
      sendResponse(currentPageLanguage);
    } else if (request.action === "getCurrentPageLanguageState") {
      sendResponse(pageLanguageState);
    } else if (request.action === "getCurrentPageTranslatorService") {
      sendResponse(currentPageTranslatorService);
    } else if (request.action === "swapTranslationService") {
      pageTranslator.swapTranslationService();
    } else if (request.action === "toggle-translation") {
      if (pageLanguageState === "translated") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage();
      }
    } else if (request.action === "autoTranslateBecauseClickedALink") {
      if (twpConfig.get("autoTranslateWhenClickingALink") === "yes") {
        pageTranslator.onGetOriginalTabLanguage(function () {
          if (
            pageLanguageState === "original" &&
            originalTabLanguage !== currentTargetLanguage &&
            twpConfig
              .get("neverTranslateLangs")
              .indexOf(originalTabLanguage) === -1
          ) {
            pageTranslator.translatePage();
          }
        });
      }
    }
  });

  // Requests the detection of the tab language in the background
  if (window.self === window.top) {
    // is main frame
    const onTabVisible = function () {
      chrome.runtime.sendMessage(
        {
          action: "detectTabLanguage",
        },
        (result) => {
          result = result || "und";
          if (result === "und") {
            originalTabLanguage = result;
            if (
              twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !== -1
            ) {
              pageTranslator.translatePage();
            }
          } else {
            const langCode = twpLang.fixTLanguageCode(result);
            if (langCode) {
              originalTabLanguage = langCode;
            }
            if (
              location.hostname === "translatewebpages.org" &&
              location.href.indexOf("?autotranslate") !== -1 &&
              twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1
            ) {
              pageTranslator.translatePage();
            } else {
              if (
                location.hostname !== "translate.googleusercontent.com" &&
                location.hostname !== "translate.google.com" &&
                location.hostname !== "translate.yandex.com"
              ) {
                if (
                  pageLanguageState === "original" &&
                  !platformInfo.isMobile.any &&
                  !chrome.extension.inIncognitoContext
                ) {
                  if (
                    twpConfig
                      .get("neverTranslateSites")
                      .indexOf(tabHostName) === -1
                  ) {
                    if (
                      langCode &&
                      langCode !== currentTargetLanguage &&
                      twpConfig
                        .get("alwaysTranslateLangs")
                        .indexOf(langCode) !== -1
                    ) {
                      pageTranslator.translatePage();
                    } else if (
                      twpConfig
                        .get("alwaysTranslateSites")
                        .indexOf(tabHostName) !== -1
                    ) {
                      pageTranslator.translatePage();
                    }
                  }
                }
              }
            }
          }

          observers.forEach((callback) => callback(originalTabLanguage));
          alreadyGotTheLanguage = true;
        }
      );
    };
    setTimeout(function () {
      if (document.visibilityState == "visible") {
        onTabVisible();
      } else {
        const handleVisibilityChange = function () {
          if (document.visibilityState == "visible") {
            document.removeEventListener(
              "visibilitychange",
              handleVisibilityChange
            );
            onTabVisible();
          }
        };
        document.addEventListener(
          "visibilitychange",
          handleVisibilityChange,
          false
        );
      }
    }, 120);
  } else {
    // is subframe (iframe)
    chrome.runtime.sendMessage(
      {
        action: "getMainFrameTabLanguage",
      },
      (result) => {
        originalTabLanguage = result || "und";
        observers.forEach((callback) => callback(originalTabLanguage));
        alreadyGotTheLanguage = true;
      }
    );

    // 获取主帧状态
    chrome.runtime.sendMessage(
      {
        action: "getMainFramePageLanguageState",
      },
      (result) => {
        if (result === "translated" && pageLanguageState === "original") {
          pageTranslator.translatePage();
        }
      }
    );
  }

  showOriginal.enabledObserverSubscribe(function () {
    if (pageLanguageState !== "original") {
      pageTranslator.translatePage();
    }
  });
});
