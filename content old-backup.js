// PlayEntry Community Enhancer - Next.js 충돌 방지 버전
(function() {
  // Constants - 속도 향상을 위해 모든 시간 값 감소
  const REFRESH_INTERVAL = 1000; // 1초로 줄임
  const BACKGROUND_REFRESH_INTERVAL = 3000; // 3초로 줄임
  const MAX_POSTS_TO_DISPLAY = 50;
  const FETCH_RETRY_DELAY = 1000; // 1초로 줄임
  const MAX_FETCH_RETRIES = 3;
  const DOM_OPERATION_DELAY = 20; // 20ms로 줄임
  const MUTATION_THROTTLE = 100; // 100ms로 줄임

  // 스티커 관련 상태 변수
  let stickerTabs = [];
  let currentStickerTabId = null;
  let currentStickers = [];
  let selectedSticker = null;
  let activeStickerElement = null;
  let temporaryPostSticker = null;
  let temporaryCommentSticker = null;
  let temporaryPostStickerItem = null;
  let temporaryCommentStickerItem = null;
  
  // State variables
  let csrfToken = '';
  let xToken = '';
  let userId = '';
  let latestPosts = [];
  let visibleMorePosts = [];
  let activeCommentThreads = {};
  let currentSearchAfter = null;
  let isUserViewingNewPosts = true;
  let urlParams = new URLSearchParams(window.location.search);
  let fetchRetryCount = 0;
  let observerInitialized = false;
  let isInitialized = false;
  let initializationAttempts = 0;
  const MAX_INIT_ATTEMPTS = 5;
  let lastDomOperation = 0;
  let pendingDomOperations = [];
  let isProcessingDomQueue = false;
  let mutationTimeoutId = null;
  let containerReady = false;

  // URL 매개변수
  let sortParam = urlParams.get('sort') || 'created';
  let termParam = urlParams.get('term') || 'all';
  let queryParam = urlParams.get('query') || '';

  // 안전한 DOM 조작을 위한 큐 시스템
  function queueDomOperation(operation) {
    return new Promise((resolve, reject) => {
      pendingDomOperations.push({
        operation,
        resolve,
        reject
      });
      
      if (!isProcessingDomQueue) {
        processDomQueue();
      }
    });
  }

  // 스티커 탭 목록 가져오기
  async function fetchStickerTabs() {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for fetchStickerTabs');
        return [];
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/SELECT_STICKERS", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_STICKERS {
              stickers {
                list {
                  id
                  title
                  image {
                    id
                    name
                    label {
                      ko
                      en
                      ja
                      vn
                    }
                    filename
                    imageType
                    dimension {
                      width
                      height
                    }
                    trimmed {
                      filename
                      width
                      height
                    }
                  }
                }
              }
            }
          `,
          variables: {}
        }),
        credentials: "include"
      });

      const data = await response.json();
      
      if (data && data.data && data.data.stickers && data.data.stickers.list) {
        stickerTabs = data.data.stickers.list;
        console.log('스티커 탭 목록 가져옴:', stickerTabs.length);
        return stickerTabs;
      } else {
        console.error('스티커 탭 데이터 형식 오류:', data);
        return [];
      }
    } catch (error) {
      console.error('스티커 탭 가져오기 오류:', error);
      return [];
    }
  }

  // 특정 탭의 스티커 목록 가져오기
  async function fetchStickersForTab(tabId) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for fetchStickersForTab');
        return [];
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/SELECT_STICKER", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_STICKER($id: ID, $title: String){
              sticker(id: $id, title: $title){
                id
                title
                image {
                  id
                  name
                  label {
                    ko
                    en
                    ja
                    vn
                  }
                  filename
                  imageType
                  dimension {
                    width
                    height
                  }
                  trimmed {
                    filename
                    width
                    height
                  }
                }
                stickers {
                  id
                  name
                  label {
                    ko
                    en
                    ja
                    vn
                  }
                  filename
                  imageType
                  dimension {
                    width
                    height
                  }
                  trimmed {
                    filename
                    width
                    height
                  }
                }
              }
            }
          `,
          variables: {
            id: tabId
          }
        }),
        credentials: "include"
      });
  
      const responseText = await response.text();
      console.log('스티커 탭 응답:', responseText);
  
      try {
        const data = JSON.parse(responseText);
        
        if (data && data.data && data.data.sticker && data.data.sticker.stickers) {
          currentStickers = data.data.sticker.stickers;
          currentStickerTabId = tabId;
          console.log('탭 스티커 목록 가져옴:', currentStickers.length);
          
          // 각 스티커 ID 문자열로 변환 확인
          currentStickers = currentStickers.map(sticker => {
            if (sticker.id && typeof sticker.id !== 'string') {
              sticker.id = sticker.id.toString();
            }
            return sticker;
          });
          
          return currentStickers;
        } else {
          console.error('스티커 데이터 형식 오류:', data);
          return [];
        }
      } catch (parseError) {
        console.error('스티커 탭 응답 파싱 오류:', parseError);
        return [];
      }
    } catch (error) {
      console.error('스티커 목록 가져오기 오류:', error);
      return [];
    }
  }

  // 스티커 선택 UI 표시
  async function showStickerSelector(targetElement, forPost = true) {
    try {
      // 이미 열려있는 스티커 선택기 제거
      const existingSelector = document.querySelector('.custom-sticker-selector');
      if (existingSelector) {
        await safeRemoveElement(existingSelector);
      }
      
      // 활성 요소 저장
      activeStickerElement = targetElement;
      
      // 스티커 탭 가져오기 (없으면)
      if (stickerTabs.length === 0) {
        await fetchStickerTabs();
      }
      
      if (stickerTabs.length === 0) {
        console.error('스티커 탭을 가져올 수 없습니다.');
        return;
      }
      
      // 첫 번째 탭의 스티커 가져오기 (없으면)
      if (currentStickers.length === 0 || currentStickerTabId !== stickerTabs[0].id) {
        await fetchStickersForTab(stickerTabs[0].id);
      }
      
      // 스티커 선택기 컨테이너 생성
      const stickerSelectorContainer = document.createElement('div');
      stickerSelectorContainer.className = 'custom-sticker-selector css-1viloiz e1h77j9v4';
      stickerSelectorContainer.style.position = 'absolute';
      stickerSelectorContainer.style.zIndex = '1000';
      stickerSelectorContainer.dataset.customExtension = 'true';
      
      // 탭 HTML 생성
      let tabsHTML = '<div class="css-16ih3f8 ep1nhyt5"><div class="css-zcg0zv ep1nhyt4">';
      
      // 이전 버튼
      tabsHTML += `
        <button type="button" class="btn_prev flicking-arrow-prev is-outside css-65blbf ep1nhyt1">
          <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" fill-rule="evenodd">
              <circle stroke="#16d8a3" cx="12" cy="12" r="11.5"></circle>
              <path d="m10.356 12 3.894 3.408a.545.545 0 0 1-.718.82l-4.364-3.817a.545.545 0 0 1 0-.821l4.364-3.819a.545.545 0 1 1 .718.821L10.356 12z" fill="#16d8a3"></path>
            </g>
          </svg>
          <span class="blind">스티커 탭 이전 보기</span>
        </button>
      `;
      
      // 탭 목록
    // 탭 목록
    tabsHTML += '<div data-select-index="1" class="css-xq7ycv ep1nhyt3"><div class="flicking-viewport"><ul class="flicking-camera" style="transform: translate(0px);">';

    stickerTabs.forEach((tab, index) => {
      // 이미지 URL 생성
      let imageUrl = '/img/EmptyImage.svg';
      if (tab.image && tab.image.filename) {
        const firstTwo = tab.image.filename.substring(0, 2);
        const secondTwo = tab.image.filename.substring(2, 4);
        const filename = tab.image.filename;
        const extension = tab.image.imageType ? `.${tab.image.imageType.toLowerCase()}` : '';
        imageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
      }
      
      // 선택된 탭인지 확인
      const isSelected = index === 0; // 첫 번째 탭을 기본 선택
      
      tabsHTML += `
        <li class="css-1nidk14 ep1nhyt2 ${isSelected ? 'active' : ''}" data-tab-id="${tab.id}">
          <button type="button">
            <img src="${imageUrl}" width="55" height="39" alt="${tab.title || '스티커 탭'}" style="display: block;">
          </button>
          ${isSelected ? '<span class="blind">선택됨</span>' : ''}
        </li>
      `;
    });
      
      tabsHTML += '</ul></div></div>';
      
      // 다음 버튼
      tabsHTML += `
        <button type="button" class="btn_next flicking-arrow-next is-outside css-65blbf ep1nhyt1">
          <svg width="24" height="24" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" fill-rule="evenodd">
              <circle stroke="#16d8a3" cx="12" cy="12" r="11.5"></circle>
              <path d="m10.356 12 3.894 3.408a.545.545 0 0 1-.718.82l-4.364-3.817a.545.545 0 0 1 0-.821l4.364-3.819a.545.545 0 1 1 .718.821L10.356 12z" fill="#16d8a3"></path>
            </g>
          </svg>
          <span class="blind">스티커 탭 다음 보기</span>
        </button>
      `;
      
      tabsHTML += '</div>';
      
      // 스티커 목록 HTML 생성
      let stickersHTML = '<div class="css-anbigi ep1nhyt0"><ul>';

      currentStickers.forEach(sticker => {
        // 이미지 URL 생성
        let imageUrl = '/img/EmptyImage.svg';
        if (sticker.filename) {
          const firstTwo = sticker.filename.substring(0, 2);
          const secondTwo = sticker.filename.substring(2, 4);
          const filename = sticker.filename;
          const extension = sticker.imageType ? `.${sticker.imageType.toLowerCase()}` : '';
          imageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
        }
        
        // span 태그의 스타일을 직접 지정하여 이미지 표시 문제 해결
        stickersHTML += `
          <li data-sticker-id="${sticker.id}">
            <span style="display: flex; justify-content: center; align-items: center; width: 74px; height: 74px; cursor: pointer; transition: opacity 0.1s; overflow: visible;">
              <img src="${imageUrl}" alt="${sticker.name || 'sticker'}" style="max-width: 74px; max-height: 74px; display: block;">
            </span>
          </li>
        `;
      });
      
      stickersHTML += '</ul></div>';
      
      // 탭과 스티커 목록 병합
      stickerSelectorContainer.innerHTML = tabsHTML + stickersHTML;
      
      // 문서에 추가
      await safeAppendChild(document.body, stickerSelectorContainer);
      
      // 위치 조정
      const rect = targetElement.getBoundingClientRect();
      stickerSelectorContainer.style.top = `${rect.bottom + window.scrollY}px`;
      stickerSelectorContainer.style.left = `${rect.left + window.scrollX}px`;
      
      // 이벤트 리스너 추가
      // 탭 클릭
      const tabElements = stickerSelectorContainer.querySelectorAll('.ep1nhyt2');
tabElements.forEach(tabElement => {
  tabElement.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    
    const tabId = tabElement.dataset.tabId;
    if (tabId) {
      // 스티커 목록 가져오기
      await fetchStickersForTab(tabId);
      
      // 선택 표시 업데이트 - active 클래스 추가
      tabElements.forEach(el => {
        el.classList.remove('active');
        const selectedSpan = el.querySelector('.blind');
        if (selectedSpan) {
          safeRemoveElement(selectedSpan);
        }
      });
      
      // 현재 탭에 active 클래스 추가
      tabElement.classList.add('active');
      
      const selectedSpan = document.createElement('span');
      selectedSpan.className = 'blind';
      selectedSpan.textContent = '선택됨';
      await safeAppendChild(tabElement, selectedSpan);
      
      // 스티커 목록 업데이트 - 여기가 문제!
      const stickersContainer = stickerSelectorContainer.querySelector('.css-anbigi ul');
      if (stickersContainer) {
        let updatedStickersHTML = '';
        currentStickers.forEach(sticker => {
          // 이미지 URL 생성
          let imageUrl = '/img/EmptyImage.svg';
          if (sticker.filename) {
            const firstTwo = sticker.filename.substring(0, 2);
            const secondTwo = sticker.filename.substring(2, 4);
            const filename = sticker.filename;
            const extension = sticker.imageType ? `.${sticker.imageType.toLowerCase()}` : '';
            imageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
          }
          
          // 여기에서 스타일 직접 지정하여 문제 해결
          updatedStickersHTML += `
            <li data-sticker-id="${sticker.id}">
              <span style="display: flex; justify-content: center; align-items: center; width: 74px; height: 74px; cursor: pointer; transition: opacity 0.1s; overflow: visible;">
                <img src="${imageUrl}" alt="${sticker.name || 'sticker'}" style="max-width: 74px; max-height: 74px; display: block;">
              </span>
            </li>
          `;
        });
        
        await safeSetInnerHTML(stickersContainer, updatedStickersHTML);
        
        // 스티커 클릭 이벤트 다시 추가
        addStickerClickEvents(stickerSelectorContainer, forPost);
      }
    }
  });
});

      // 스티커 클릭 이벤트 추가
      addStickerClickEvents(stickerSelectorContainer, forPost);
      
      // 이전/다음 버튼 클릭
      const prevButton = stickerSelectorContainer.querySelector('.btn_prev');
      const nextButton = stickerSelectorContainer.querySelector('.btn_next');
      
      if (prevButton) {
        prevButton.addEventListener('click', event => {
          event.preventDefault();
          scrollStickerTabs(stickerSelectorContainer, -1);
        });
      }
      
      if (nextButton) {
        nextButton.addEventListener('click', event => {
          event.preventDefault();
          scrollStickerTabs(stickerSelectorContainer, 1);
        });
      }
      
      // 외부 클릭 시 닫기
      document.addEventListener('click', handleOutsideStickerClick);
      
    } catch (error) {
      console.error('스티커 선택기 표시 오류:', error);
    }
  }

  // 스티커 클릭 이벤트 추가
  function addStickerClickEvents(selectorContainer, forPost) {
    // 수정된 선택자로 스티커 요소 찾기
    const stickerElements = selectorContainer.querySelectorAll('.css-anbigi ul li');
    
    stickerElements.forEach(stickerElement => {
      stickerElement.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        
        const stickerId = stickerElement.dataset.stickerId;
        if (stickerId) {
          // 선택된 스티커 정보 찾기
          const selectedStickerInfo = currentStickers.find(s => s.id === stickerId);
          if (selectedStickerInfo) {
            // 스티커 선택 처리
            selectSticker(selectedStickerInfo, forPost);
            
            // 선택기 닫기
            safeRemoveElement(selectorContainer);
            document.removeEventListener('click', handleOutsideStickerClick);
          }
        }
      });
    });
  }

  // 스티커 선택기 외부 클릭 처리
  function handleOutsideStickerClick(event) {
    const stickerSelector = document.querySelector('.custom-sticker-selector');
    if (stickerSelector && !stickerSelector.contains(event.target)) {
      // 스티커 버튼이면 무시
      if (event.target.closest('.css-1394o6u')) {
        return;
      }
      
      safeRemoveElement(stickerSelector);
      document.removeEventListener('click', handleOutsideStickerClick);
    }
  }

  // 스티커 탭 스크롤
  function scrollStickerTabs(selectorContainer, direction) {
    const tabsContainer = selectorContainer.querySelector('.flicking-camera');
    if (tabsContainer) {
      const currentTransform = tabsContainer.style.transform;
      const currentX = parseInt(currentTransform.match(/translate\((-?\d+)px\)/) ? 
                                currentTransform.match(/translate\((-?\d+)px\)/)[1] : 0);
      
      const tabWidth = 60; // 각 탭의 대략적인 너비
      const visibleTabs = 4; // 한 번에 보여지는 탭 수
      const maxScroll = Math.max(0, (stickerTabs.length - visibleTabs) * tabWidth);
      
      let newX = currentX - (direction * tabWidth * visibleTabs);
      newX = Math.min(0, Math.max(-maxScroll, newX));
      
      tabsContainer.style.transform = `translate(${newX}px)`;
    }
  }

  // 스티커 선택 처리
  async function selectSticker(stickerInfo, forPost) {
    try {
      // 이미지 URL 생성
      let imageUrl = '/img/EmptyImage.svg';
      if (stickerInfo.filename) {
        const firstTwo = stickerInfo.filename.substring(0, 2);
        const secondTwo = stickerInfo.filename.substring(2, 4);
        const filename = stickerInfo.filename;
        const extension = stickerInfo.imageType ? `.${stickerInfo.imageType.toLowerCase()}` : '';
        imageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
      }
      
      // 현재 선택된 탭 ID와 스티커 ID 저장
      if (forPost) {
        // 게시글 스티커
        temporaryPostSticker = currentStickerTabId;
        temporaryPostStickerItem = stickerInfo.id;
        console.log('게시글 스티커 선택됨 - 탭:', temporaryPostSticker, '아이템:', temporaryPostStickerItem);
        await displayTemporaryPostSticker(imageUrl);
      } else {
        // 댓글 스티커
        temporaryCommentSticker = currentStickerTabId;
        temporaryCommentStickerItem = stickerInfo.id;
        console.log('댓글 스티커 선택됨 - 탭:', temporaryCommentSticker, '아이템:', temporaryCommentStickerItem);
        await displayTemporaryCommentSticker(imageUrl);
      }
    } catch (error) {
      console.error('스티커 선택 처리 오류:', error);
    }
  }

  // 임시 게시글 스티커 표시
  async function displayTemporaryPostSticker(imageUrl) {
    try {
      if (!activeStickerElement) return;
      
      // 기존 스티커 제거
      const existingSticker = activeStickerElement.querySelector('.css-fjfa6z');
      if (existingSticker) {
        await safeRemoveElement(existingSticker);
      }
      
      // 새 스티커 컨테이너 생성
      const stickerContainer = document.createElement('div');
      stickerContainer.className = 'css-fjfa6z e1h77j9v3';
      stickerContainer.dataset.customExtension = 'true';
      
      // 스티커 HTML
      stickerContainer.innerHTML = `
        <em>
          <img src="${imageUrl}" alt="게시글 첨부 스티커" style="width: 105px; height: 105px;">
          <a href="/" role="button" class="remove-sticker-btn">
            <span class="blind">스티커 닫기</span>
          </a>
        </em>
      `;
      
      // 문서에 추가
      const editorContainer = activeStickerElement.closest('.css-1cyfuwa');
      if (editorContainer) {
        await safeAppendChild(editorContainer, stickerContainer);
        
        // 스티커 제거 버튼 이벤트
        const removeButton = stickerContainer.querySelector('.remove-sticker-btn');
        if (removeButton) {
          removeButton.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            removeTemporaryPostSticker();
          });
        }
      }
    } catch (error) {
      console.error('임시 게시글 스티커 표시 오류:', error);
    }
  }

  // 임시 댓글 스티커 표시
  async function displayTemporaryCommentSticker(imageUrl) {
    try {
      if (!activeStickerElement) return;
      
      // 기존 스티커 제거
      const existingSticker = activeStickerElement.querySelector('.css-fjfa6z');
      if (existingSticker) {
        await safeRemoveElement(existingSticker);
      }
      
      // 새 스티커 컨테이너 생성
      const stickerContainer = document.createElement('div');
      stickerContainer.className = 'css-fjfa6z e1h77j9v3';
      stickerContainer.dataset.customExtension = 'true';
      
      // 스티커 HTML
      stickerContainer.innerHTML = `
        <em>
          <img src="${imageUrl}" alt="댓글 첨부 스티커" style="width: 105px; height: 105px;">
          <a href="/" role="button" class="remove-sticker-btn">
            <span class="blind">스티커 닫기</span>
          </a>
        </em>
      `;
      
      // 문서에 추가
      const editorContainer = activeStickerElement.closest('.css-1cyfuwa');
      if (editorContainer) {
        await safeAppendChild(editorContainer, stickerContainer);
        
        // 스티커 제거 버튼 이벤트
        const removeButton = stickerContainer.querySelector('.remove-sticker-btn');
        if (removeButton) {
          removeButton.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            removeTemporaryCommentSticker();
          });
        }
      }
    } catch (error) {
      console.error('임시 댓글 스티커 표시 오류:', error);
    }
  }

  // 임시 게시글 스티커 제거
  async function removeTemporaryPostSticker() {
    try {
      temporaryPostSticker = null;
      temporaryPostStickerItem = null;
      
      // 스티커 UI 제거
      if (activeStickerElement) {
        const stickerContainer = activeStickerElement.closest('.css-1cyfuwa')?.querySelector('.css-fjfa6z');
        if (stickerContainer) {
          await safeRemoveElement(stickerContainer);
        }
      }
    } catch (error) {
      console.error('임시 게시글 스티커 제거 오류:', error);
    }
  }

  // 임시 댓글 스티커 제거
  async function removeTemporaryCommentSticker() {
    try {
      temporaryCommentSticker = null;
      
      // 스티커 UI 제거
      if (activeStickerElement) {
        const stickerContainer = activeStickerElement.closest('.css-1cyfuwa')?.querySelector('.css-fjfa6z');
        if (stickerContainer) {
          await safeRemoveElement(stickerContainer);
        }
      }
    } catch (error) {
      console.error('임시 댓글 스티커 제거 오류:', error);
    }
  }


  // DOM 조작 큐 처리
  async function processDomQueue() {
    if (pendingDomOperations.length === 0) {
      isProcessingDomQueue = false;
      return;
    }
    
    isProcessingDomQueue = true;
    const now = Date.now();
    
    if (now - lastDomOperation < DOM_OPERATION_DELAY) {
      setTimeout(processDomQueue, DOM_OPERATION_DELAY);
      return;
    }
    
    const task = pendingDomOperations.shift();
    
    try {
      const result = await task.operation();
      task.resolve(result);
      lastDomOperation = Date.now();
      
      // 큐에 작업이 남아있으면 즉시 다음 작업 처리 시도
      if (pendingDomOperations.length > 0) {
        setTimeout(processDomQueue, 0);
      } else {
        isProcessingDomQueue = false;
      }
    } catch (error) {
      console.error('DOM operation failed:', error);
      task.reject(error);
      lastDomOperation = Date.now();
      
      // 오류가 발생해도 즉시 다음 작업 처리 시도
      if (pendingDomOperations.length > 0) {
        setTimeout(processDomQueue, 0);
      } else {
        isProcessingDomQueue = false;
      }
    }
  }

  // 안전한 HTML 문자열 생성 (XSS 방지)
  function safeHTML(unsafeText) {
    if (typeof unsafeText !== 'string') return '';
    return unsafeText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  // 안전한 요소 선택 (null 체크 포함)
  function safeQuerySelector(selector, parentElement = document) {
    try {
      if (!parentElement) return null;
      return parentElement.querySelector(selector);
    } catch (error) {
      console.error('Error in safeQuerySelector:', error);
      return null;
    }
  }
  
  // 안전한 요소 선택 (전체)
  function safeQuerySelectorAll(selector, parentElement = document) {
    try {
      if (!parentElement) return [];
      return Array.from(parentElement.querySelectorAll(selector) || []);
    } catch (error) {
      console.error('Error in safeQuerySelectorAll:', error);
      return [];
    }
  }

  // 안전한 요소 제거
  function safeRemoveElement(element) {
    if (!element) return false;
    
    return queueDomOperation(async () => {
      try {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to remove element:', error);
        try {
          element.style.display = 'none';
          return true;
        } catch (hideError) {
          console.error('Failed to hide element:', hideError);
          return false;
        }
      }
    });
  }

  // 안전한 요소 추가
  function safeAppendChild(parent, child) {
    if (!parent || !child) return false;
    
    return queueDomOperation(async () => {
      try {
        if (document.contains(parent)) {
          parent.appendChild(child);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to append child:', error);
        return false;
      }
    });
  }

  // 안전한 요소 삽입
  function safeInsertBefore(parent, newElement, referenceElement) {
    if (!parent || !newElement) return false;
    
    return queueDomOperation(async () => {
      try {
        if (referenceElement && parent.contains(referenceElement)) {
          parent.insertBefore(newElement, referenceElement);
          return true;
        } else {
          parent.appendChild(newElement);
          return true;
        }
      } catch (error) {
        console.error('Failed to insert element:', error);
        try {
          parent.appendChild(newElement);
          return true;
        } catch (appendError) {
          console.error('Failed to append as fallback:', appendError);
          return false;
        }
      }
    });
  }

  // 안전한 콘텐츠 설정
  function safeSetTextContent(element, text) {
    if (!element) return false;
    
    return queueDomOperation(async () => {
      try {
        if (document.contains(element)) {
          element.textContent = text;
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to set text content:', error);
        return false;
      }
    });
  }

  // 안전한 HTML 설정
  function safeSetInnerHTML(element, html) {
    if (!element) return false;
    
    return queueDomOperation(async () => {
      try {
        if (document.contains(element)) {
          element.innerHTML = html;
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to set innerHTML:', error);
        return false;
      }
    });
  }

  // Helper function for fetching with retries
  async function fetchWithRetry(url, options, retryCount = 0) {
    try {
      const response = await fetch(url, options);
      fetchRetryCount = 0;
      return response;
    } catch (error) {
      console.error(`Fetch error (attempt ${retryCount + 1}/${MAX_FETCH_RETRIES}):`, error);
      
      if (retryCount < MAX_FETCH_RETRIES) {
        console.log(`Retrying fetch in ${FETCH_RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY));
        return fetchWithRetry(url, options, retryCount + 1);
      }
      
      throw error;
    }
  }

  // 안전한 초기화
  function safeInit() {
    if (isInitialized) return; // 이미 초기화된 경우 중복 실행 방지
    
    try {
      console.log('PlayEntry Community Enhancer starting initialization');
      
      urlParams = new URLSearchParams(window.location.search);
      sortParam = urlParams.get('sort') || 'created';
      termParam = urlParams.get('term') || 'all';
      queryParam = urlParams.get('query') || '';
      
      console.log(`Initializing with params: sort=${sortParam}, term=${termParam}, query=${queryParam ? queryParam : 'none'}`);
      
      // 토큰 추출 시도
      if (extractTokens()) {
        // 토큰 추출 성공시 즉시 컨테이너 찾기 시작
        checkForPostsContainer();
        setupEventListeners();
        isInitialized = true;
        initializationAttempts = 0;
        console.log('PlayEntry Community Enhancer initialized successfully');
      } else {
        // 토큰 추출 실패시 재시도
        initializationAttempts++;
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
          console.log(`Token extraction failed, retry attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS}`);
          // 즉시 재시도
          safeInit();
        } else {
          console.error('Failed to initialize after maximum attempts');
        }
      }
    } catch (error) {
      console.error('Error during initialization:', error);
      initializationAttempts++;
      if (initializationAttempts < MAX_INIT_ATTEMPTS) {
        console.log(`Initialization error, retry attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS}`);
        // 즉시 재시도
        safeInit();
      } else {
        console.error('Failed to initialize after maximum attempts');
      }
    }
  }

  // 토큰 추출
  function extractTokens() {
    console.log('Extracting tokens...');
    
    try {
      // Get CSRF token
      const metaToken = safeQuerySelector('meta[name="csrf-token"]');
      if (metaToken) {
        csrfToken = metaToken.getAttribute('content');
        console.log('CSRF token extracted:', csrfToken);
      } else {
        console.error('CSRF token not found');
        return false;
      }
  
      // Get X token from __NEXT_DATA__
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent);
          
          // Recursive function to find xToken
          function findXToken(obj) {
            if (obj && typeof obj === 'object') {
              if ('xToken' in obj) {
                return obj.xToken;
              }
              for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                  const result = findXToken(obj[key]);
                  if (result) return result;
                }
              }
            }
            return null;
          }
          
          xToken = findXToken(data);
          
          if (xToken) {
            console.log('X token extracted successfully:', xToken.substring(0, 20) + '...');
          } else {
            console.error('X token not found in data');
            return false;
          }
        } catch (error) {
          console.error('Error parsing JSON for X token:', error);
          return false;
        }
      } else {
        console.error('__NEXT_DATA__ element not found');
        return false;
      }
      
      // Get user ID - 비동기 처리지만 계속 진행
      fetchUserTopics().then(id => {
        if (id) {
          userId = id;
          console.log('User ID extracted:', userId);
        }
      }).catch(error => {
        console.error('Error fetching user topics:', error);
      });
      
      return !!(csrfToken && xToken);
    } catch (error) {
      console.error('Error during token extraction:', error);
      return false;
    }
  }

  // 게시글 컨테이너 즉시 확인
  function checkForPostsContainer() {
    const container = safeQuerySelector('ul.css-1urx3um.e18x7bg03');
    
    if (container) {
      console.log('Posts container found immediately');
      // 컨테이너를 찾았을 때 즉시 처리
      processFoundContainer(container);
    } else {
      // 컨테이너를 찾지 못했을 때는 MutationObserver로 DOM 변화 감시
      console.log('Posts container not found immediately, setting up observer');
      observeForPostsContainer();
    }
  }
  
  // DOM 변화를 감시하여 컨테이너 찾기
  function observeForPostsContainer() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const container = safeQuerySelector('ul.css-1urx3um.e18x7bg03');
          if (container) {
            console.log('Posts container found via observer');
            observer.disconnect();
            processFoundContainer(container);
            return;
          }
        }
      }
    });
    
    // 문서 전체 변화 감시
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // 백업으로 일정 시간 후 다시 확인
    setTimeout(() => {
      if (!containerReady) {
        const container = safeQuerySelector('ul.css-1urx3um.e18x7bg03');
        if (container) {
          console.log('Posts container found via timeout check');
          observer.disconnect();
          processFoundContainer(container);
        } else {
          console.error('Posts container not found after timeout');
        }
      }
    }, 1000);
  }
  
  // 발견된 컨테이너 처리
  function processFoundContainer(container) {
    if (containerReady) return; // 이미 처리된 경우 중복 실행 방지
    
    containerReady = true;
    
    try {
      // 자체적인 컨테이너 생성
      createCustomContainer(container).then(customContainer => {
        if (customContainer) {
          console.log('Custom container created successfully');
          
          // 토큰 체크 및 게시글 가져오기 시작
          if (csrfToken && xToken) {
            startFetchingPosts(customContainer);
          } else {
            console.log('Tokens not ready yet, extracting again...');
            extractTokens();
            startFetchingPosts(customContainer);
          }
          
          // 컨테이너 유지 체크 (주기적 반복 대신 MutationObserver 사용)
          setupContainerObserver(container);
        }
      }).catch(error => {
        console.error('Error creating custom container:', error);
      });
    } catch (error) {
      console.error('Error processing found container:', error);
    }
  }
  
  // 컨테이너 변화 감시
  function setupContainerObserver(originalContainer) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if ((mutation.type === 'attributes' && mutation.attributeName === 'style') ||
            (mutation.type === 'childList') || 
            !document.contains(originalContainer)) {
          ensureCustomContainerExists(originalContainer);
        }
      }
    });
    
    // 원본 컨테이너와 그 부모 노드 감시
    observer.observe(originalContainer, {
      attributes: true,
      childList: true
    });
    
    if (originalContainer.parentNode) {
      observer.observe(originalContainer.parentNode, {
        childList: true
      });
    }
  }

  // 자체 컨테이너 생성 - 기존 DOM과의 충돌을 최소화하기 위해
  async function createCustomContainer(originalContainer) {
    return queueDomOperation(async () => {
      try {
        const existingCustomContainer = safeQuerySelector('#custom-entry-enhancer-container');
        if (existingCustomContainer) {
          return existingCustomContainer;
        }
        
        const customContainer = document.createElement('div');
        customContainer.id = 'custom-entry-enhancer-container';
        customContainer.style.width = '100%';
        
        const customPostsList = document.createElement('ul');
        customPostsList.id = 'custom-entry-posts-list';
        customPostsList.className = 'css-1urx3um e18x7bg03';
        customPostsList.dataset.customExtension = 'true';
        
        customContainer.appendChild(customPostsList);
        
        originalContainer.style.display = 'none';
        
        const parentElement = originalContainer.parentNode;
        if (parentElement) {
          parentElement.insertBefore(customContainer, originalContainer.nextSibling);
        }
        
        return customContainer;
      } catch (error) {
        console.error('Error creating custom container:', error);
        return null;
      }
    });
  }

  // 커스텀 컨테이너가 존재하는지 확인하고 없으면 다시 생성
  async function ensureCustomContainerExists(originalContainer) {
    const customContainer = safeQuerySelector('#custom-entry-enhancer-container');
    
    if (!customContainer || !document.contains(customContainer)) {
      console.log('Custom container missing, recreating...');
      await createCustomContainer(originalContainer);
    }
    
    if (originalContainer && originalContainer.style.display !== 'none') {
      await queueDomOperation(async () => {
        originalContainer.style.display = 'none';
        return true;
      });
    }
  }
  
  // 게시글 내용 요소를 찾기 위한 개선된 함수
  function findPostContent(postItem) {
    // 가능한 모든 선택자를 시도합니다
    const possibleSelectors = [
      '.css-6wq60h', 
      '.css-6wq60h.e1i41bku1', 
      '.e1i41bku1',  // 클래스 이름만으로 시도
      'div[class*="css"][class*="e1i41bku"]', // 부분 매칭
      'div.e1877mpo2 > div:nth-child(3)', // 위치 기반 선택자
      '.css-puqjcw > div:nth-child(3)'    // 부모에서 순서 기반
    ];

    // 각 선택자를 시도하고 첫 번째로 찾은 요소를 반환합니다
    for (const selector of possibleSelectors) {
      const element = postItem.querySelector(selector);
      if (element) {
        console.log(`게시글 내용 요소 발견: 선택자 '${selector}' 사용`);
        return element;
      }
    }

    // 선택자로 찾지 못한 경우 DOM 구조를 직접 탐색합니다
    try {
      // 첫 번째 div(css-puqjcw) 내의 모든 div 요소를 가져옵니다
      const container = postItem.querySelector('.css-puqjcw') || 
                        postItem.querySelector('div:first-child');
      
      if (container) {
        // container 내의 모든 div 요소 중 게시글 내용으로 보이는 요소를 찾습니다
        const divs = Array.from(container.querySelectorAll('div'));
        // 중간 위치의 div(보통 3번째)가 내용인 경우가 많습니다
        if (divs.length >= 3) {
          console.log('DOM 구조에서 게시글 내용 요소 추정: 구조 기반 탐색');
          return divs[2]; // 대략 3번째 div가 내용일 가능성이 높습니다
        }
      }
    } catch (e) {
      console.error('DOM 구조 탐색 중 오류:', e);
    }
    
    // 모든 방법이 실패한 경우 null 반환
    console.error('게시글 내용 요소를 찾을 수 없습니다. DOM 구조가 변경되었을 수 있습니다.');
    return null;
  }

  // 수정하기 버튼 클릭 처리 함수 - 개선된 버전
  function handleEditClick(e, postItem, postId) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('수정하기 버튼 클릭됨!');
    console.log('postItem:', postItem);
    console.log('postId:', postId);
    
    // 개선된 내용 요소 찾기 함수 사용
    const postContentElement = findPostContent(postItem);
    
    if (postContentElement) {
      const postContent = postContentElement.textContent || '';
      console.log('찾은 게시글 내용:', postContent);
      showEditForm(postItem, postId, postContent);
    } else {
      // 내용 요소를 찾지 못했을 경우에도 빈 내용으로 수정 폼 표시
      console.warn('게시글 내용을 찾지 못했지만 빈 내용으로 수정 폼을 표시합니다.');
      showEditForm(postItem, postId, '');
    }
  }

  // 신고하기 버튼 클릭 처리 함수
  function handleReportClick(e, postItem, postId) {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('신고하기 버튼 클릭됨!');
    console.log('postId:', postId);
    
    // 신고 확인 모달 생성
    showReportConfirmation(postItem, postId);
  }

  // 신고 확인 모달 표시
  async function showReportConfirmation(postItem, postId) {
    try {
      // 기존 모달이 있으면 제거
      const existingModal = document.querySelector('.custom-report-modal');
      if (existingModal) {
        await safeRemoveElement(existingModal);
      }
      
      // 모달 컨테이너 생성
      const modalContainer = document.createElement('div');
      modalContainer.className = 'custom-report-modal';
      modalContainer.style.position = 'fixed';
      modalContainer.style.top = '0';
      modalContainer.style.left = '0';
      modalContainer.style.width = '100%';
      modalContainer.style.height = '100%';
      modalContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      modalContainer.style.display = 'flex';
      modalContainer.style.justifyContent = 'center';
      modalContainer.style.alignItems = 'center';
      modalContainer.style.zIndex = '9999';
      
      // 모달 내용 생성
      modalContainer.innerHTML = `
        <div class="css-6zwuwq ejqp9sd8">
          <div class="css-su85lg ejqp9sd9">
            <div class="css-g2sts3 ejqp9sd5">
              <div class="css-1rsy03z ejqp9sd0">
                <div class="css-1i6ie4z e1ff2x9k0">
                  <strong class="css-14c2cg ejqp9sd4">정말로 신고할까요?</strong>
                  <p>신고된 내용이 엔트리 운영정책을 위반한 <br class="mobile">것으로 판단되면 원칙에 따라 처리합니다.</p>
                  <p>엔트리 운영정책과 무관한 신고에 대해서는 <br class="mobile">처리되지 않을 수 있고, <br class="tablet">허위로 신고한 <br class="mobile">사용자에게는 불이익이 있을 수 있어요.</p>
                </div>
              </div>
            </div>
            <div class="css-198mr1i ejqp9sd7">
              <button id="cancel-report-btn" height="42" width="0" class="css-1esh4h5 egyuc730" role="button" data-testid="button" font-size="16" style="margin-right: 8px;">취소</button>
              <button id="go-to-post-btn" height="42" width="0" class="css-fkhbxt egyuc730" role="button" data-testid="button" font-size="16">게시글로 이동</button>
            </div>
          </div>
        </div>
      `;
      
      // 모달을 문서에 추가
      await safeAppendChild(document.body, modalContainer);
      
      // 이벤트 리스너 추가
      const cancelButton = document.getElementById('cancel-report-btn');
      const goToPostButton = document.getElementById('go-to-post-btn');
      
      if (cancelButton) {
        cancelButton.addEventListener('click', async () => {
          await safeRemoveElement(modalContainer);
        });
      }
      
      if (goToPostButton) {
        goToPostButton.addEventListener('click', () => {
          // 게시글 페이지로 이동
          window.location.href = `https://playentry.org/community/entrystory/${postId}`;
        });
      }
      
      // 외부 클릭 시 모달 닫기
      modalContainer.addEventListener('click', async (e) => {
        if (e.target === modalContainer) {
          await safeRemoveElement(modalContainer);
        }
      });
    } catch (error) {
      console.error('Error showing report confirmation:', error);
    }
  }

  // 가장 가까운 게시글 항목 찾기
  function findClosestPostItem(element) {
    let current = element;
    
    while (current) {
      if (current.tagName && current.tagName.toLowerCase() === 'li' && current.dataset.postId) {
        return current;
      }
      current = current.parentElement;
    }
    
    return null;
  }

  // composedPath가 지원되지 않는 브라우저를 위한 대체 함수
  function getEventPath(event) {
    const path = [];
    let currentElement = event.target;
    
    while (currentElement) {
      path.push(currentElement);
      currentElement = currentElement.parentElement;
    }
    
    if (path.indexOf(window) === -1 && path.indexOf(document) === -1) {
      path.push(document);
    }
    
    if (path.indexOf(window) === -1) {
      path.push(window);
    }
    
    return path;
  }

  // 이벤트 리스너 설정 함수 - 개선됨
  function setupEventListeners() {
    try {
      // 기존 이벤트 리스너 제거 및 새로운 리스너 추가
      document.removeEventListener('click', handleClickEvents);
      document.addEventListener('click', handleClickEvents);
      
      // 추가: data-action 속성을 가진 요소에 대한 직접 이벤트 등록
      document.addEventListener('click', function(e) {
        // 클릭된 요소 또는 그 부모 중 data-action을 가진 요소 찾기
        const actionElement = e.target.closest('[data-action]');
        if (!actionElement) return;
        
        const action = actionElement.dataset.action;
        console.log(`직접 액션 감지: ${action}`);
        
        e.preventDefault();
        e.stopPropagation();
        
        const postItem = findClosestPostItem(actionElement);
        if (!postItem) return;
        
        const postId = postItem.dataset.postId;
        if (!postId) return;
        
        // 각 액션 별 처리
        switch(action) {
          case 'edit':
            console.log('수정 액션 실행:', postId);
            const postContentElement = findPostContent(postItem);
            if (postContentElement) {
              showEditForm(postItem, postId, postContentElement.textContent || '');
            } else {
              showEditForm(postItem, postId, '');
            }
            break;
          case 'delete':
            console.log('삭제 액션 실행:', postId);
            deletePost(postId, postItem);
            break;
          case 'report':
            console.log('신고 액션 실행:', postId);
            handleReportClick(e, postItem, postId);
            break;
          case 'goto':
            console.log('게시글로 이동 액션 실행:', postId);
            window.location.href = `https://playentry.org/community/entrystory/${postId}`;
            break;
        }
      });
      
      window.addEventListener('scroll', handleScrollEvents, { passive: true });
    } catch (error) {
      console.error('Error in setupEventListeners:', error);
    }
  }

  // 수정/삭제 버튼에 리스너 추가
  function addActionListeners(li, postId) {
    try {
      // 직접 요소 선택 (다양한 방법 시도)
      const editButton = li.querySelector('[data-action="edit"]') || 
                         Array.from(li.querySelectorAll('a')).find(el => el.textContent.trim() === '수정하기');
                         
      const deleteButton = li.querySelector('[data-action="delete"]') || 
                           Array.from(li.querySelectorAll('a')).find(el => el.textContent.trim() === '삭제하기');
      
      const reportButton = li.querySelector('[data-action="report"]') || 
                          Array.from(li.querySelectorAll('a')).find(el => el.textContent.trim() === '신고하기');
      
      const gotoButton = li.querySelector('[data-action="goto"]') || 
                         Array.from(li.querySelectorAll('a')).find(el => el.textContent.trim() === '게시글로 이동');
      
      console.log('찾은 버튼들:', { editButton, deleteButton, reportButton, gotoButton });
      
      // 수정 버튼에 리스너 추가
      if (editButton) {
        // 이전 리스너 제거 (중복 방지)
        const oldClickListener = editButton._clickListener;
        if (oldClickListener) {
          editButton.removeEventListener('click', oldClickListener);
        }
        
        // 새 리스너 추가 및 저장
        const newClickListener = function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('수정 버튼 직접 클릭됨!');
          handleEditClick(e, li, postId);
        };
        
        editButton.addEventListener('click', newClickListener);
        editButton._clickListener = newClickListener;
        
        editButton.style.cursor = 'pointer';
        editButton.dataset.hasListener = 'true';
        console.log('수정 버튼에 리스너 추가 완료');
      }
      
      // 삭제 버튼에 리스너 추가
      if (deleteButton) {
        // 이전 리스너 제거 (중복 방지)
        const oldClickListener = deleteButton._clickListener;
        if (oldClickListener) {
          deleteButton.removeEventListener('click', oldClickListener);
        }
        
        // 새 리스너 추가 및 저장
        const newClickListener = function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('삭제 버튼 직접 클릭됨!');
          deletePost(postId, li);
        };
        
        deleteButton.addEventListener('click', newClickListener);
        deleteButton._clickListener = newClickListener;
        
        deleteButton.style.cursor = 'pointer';
        deleteButton.dataset.hasListener = 'true';
        console.log('삭제 버튼에 리스너 추가 완료');
      }

      // 신고 버튼에 리스너 추가
      if (reportButton) {
        // 이전 리스너 제거 (중복 방지)
        const oldClickListener = reportButton._clickListener;
        if (oldClickListener) {
          reportButton.removeEventListener('click', oldClickListener);
        }
        
        // 새 리스너 추가 및 저장
        const newClickListener = function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('신고 버튼 직접 클릭됨!');
          handleReportClick(e, li, postId);
        };
        
        reportButton.addEventListener('click', newClickListener);
        reportButton._clickListener = newClickListener;
        
        reportButton.style.cursor = 'pointer';
        reportButton.dataset.hasListener = 'true';
        console.log('신고 버튼에 리스너 추가 완료');
      }

      // 게시글로 이동 버튼에 리스너 추가
      if (gotoButton) {
        // 이전 리스너 제거 (중복 방지)
        const oldClickListener = gotoButton._clickListener;
        if (oldClickListener) {
          gotoButton.removeEventListener('click', oldClickListener);
        }
        
        // 새 리스너 추가 및 저장
        const newClickListener = function(e) {
          e.preventDefault();
          e.stopPropagation();
          console.log('게시글로 이동 버튼 직접 클릭됨!');
          window.location.href = `https://playentry.org/community/entrystory/${postId}`;
        };
        
        gotoButton.addEventListener('click', newClickListener);
        gotoButton._clickListener = newClickListener;
        
        gotoButton.style.cursor = 'pointer';
        gotoButton.dataset.hasListener = 'true';
        console.log('게시글로 이동 버튼에 리스너 추가 완료');
      }
    } catch (error) {
      console.error('버튼 리스너 추가 중 오류:', error);
    }
  }

  // 클릭 이벤트 처리 - 이벤트 위임 사용 (완전히 개선됨)
  function handleClickEvents(e) {
    try {
      // 클릭된 요소의 텍스트 콘텐츠 확인 (널 체크 포함)
      const clickedText = e.target.textContent ? e.target.textContent.trim() : '';
      
      // 클릭된 요소의 태그명 확인
      const tagName = e.target.tagName ? e.target.tagName.toLowerCase() : '';
      
      // 클릭 경로상의 모든 요소 가져오기 (이벤트 버블링 경로)
      const path = e.composedPath ? e.composedPath() : getEventPath(e);
      
      // "수정하기" 버튼 클릭 - 모든 가능한 방법으로 감지
      if (clickedText === '수정하기' || 
          (tagName === 'a' && clickedText === '수정하기') ||
          path.some(el => el.textContent && el.textContent.trim() === '수정하기')) {
        
        console.log('수정하기 버튼 클릭 감지!');
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        
        // 상위 요소에서 li 요소 찾기
        let postItem = null;
        for (const el of path) {
          if (el.tagName && el.tagName.toLowerCase() === 'li' && el.dataset.postId) {
            postItem = el;
            break;
          }
        }
        
        if (!postItem) {
          // 대체 방법: 직접 부모 요소 탐색
          postItem = findClosestPostItem(e.target);
        }
        
        if (postItem) {
          const postId = postItem.dataset.postId;
          console.log('수정 대상 게시글 ID:', postId);
          
          handleEditClick(e, postItem, postId);
        } else {
          console.error('수정할 게시글을 찾을 수 없습니다.');
        }
        return; // 이벤트 처리 완료
      }
      
      // "삭제하기" 버튼 클릭 - 모든 가능한 방법으로 감지
      if (clickedText === '삭제하기' || 
          (tagName === 'a' && clickedText === '삭제하기') ||
          path.some(el => el.textContent && el.textContent.trim() === '삭제하기')) {
        
        console.log('삭제하기 버튼 클릭 감지!');
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        
        // 상위 요소에서 li 요소 찾기
        let postItem = null;
        for (const el of path) {
          if (el.tagName && el.tagName.toLowerCase() === 'li' && el.dataset.postId) {
            postItem = el;
            break;
          }
        }
        
        if (!postItem) {
          // 대체 방법: 직접 부모 요소 탐색
          postItem = findClosestPostItem(e.target);
        }
        
        if (postItem) {
          const postId = postItem.dataset.postId;
          console.log('삭제 대상 게시글 ID:', postId);
          
          if (postId) {
            deletePost(postId, postItem);
          } else {
            console.error('삭제할 게시글 ID를 찾을 수 없습니다.');
          }
        } else {
          console.error('삭제할 게시글을 찾을 수 없습니다.');
        }
        return; // 이벤트 처리 완료
      }

      if (e.target.matches('.css-1394o6u') || e.target.closest('.css-1394o6u')) {
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        
        console.log('스티커 버튼 클릭 감지!');
        
        // 게시글 편집인지 댓글인지 확인
        const formType = e.target.closest('.css-1t2q9uf') ? 'post' : 'comment';
        const stickerButton = e.target.classList.contains('css-1394o6u') ? e.target : e.target.closest('.css-1394o6u');
        
        // 스티커 선택기 표시
        showStickerSelector(stickerButton, formType === 'post');
        return; // 이벤트 처리 완료
      }

      // "신고하기" 버튼 클릭 - 모든 가능한 방법으로 감지
      if (clickedText === '신고하기' || 
          (tagName === 'a' && clickedText === '신고하기') ||
          path.some(el => el.textContent && el.textContent.trim() === '신고하기')) {
        
        console.log('신고하기 버튼 클릭 감지!');
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        
        // 상위 요소에서 li 요소 찾기
        let postItem = null;
        for (const el of path) {
          if (el.tagName && el.tagName.toLowerCase() === 'li' && el.dataset.postId) {
            postItem = el;
            break;
          }
        }
        
        if (!postItem) {
          // 대체 방법: 직접 부모 요소 탐색
          postItem = findClosestPostItem(e.target);
        }
        
        if (postItem) {
          const postId = postItem.dataset.postId;
          console.log('신고 대상 게시글 ID:', postId);
          
          if (postId) {
            handleReportClick(e, postItem, postId);
          } else {
            console.error('신고할 게시글 ID를 찾을 수 없습니다.');
          }
        } else {
          console.error('신고할 게시글을 찾을 수 없습니다.');
        }
        return; // 이벤트 처리 완료
      }

      // "게시글로 이동" 버튼 클릭 - 모든 가능한 방법으로 감지
      if (clickedText === '게시글로 이동' || 
          (tagName === 'a' && clickedText === '게시글로 이동') ||
          path.some(el => el.textContent && el.textContent.trim() === '게시글로 이동')) {
        
        console.log('게시글로 이동 버튼 클릭 감지!');
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        
        // 상위 요소에서 li 요소 찾기
        let postItem = null;
        for (const el of path) {
          if (el.tagName && el.tagName.toLowerCase() === 'li' && el.dataset.postId) {
            postItem = el;
            break;
          }
        }
        
        if (!postItem) {
          // 대체 방법: 직접 부모 요소 탐색
          postItem = findClosestPostItem(e.target);
        }
        
        if (postItem) {
          const postId = postItem.dataset.postId;
          console.log('이동 대상 게시글 ID:', postId);
          
          if (postId) {
            window.location.href = `https://playentry.org/community/entrystory/${postId}`;
          } else {
            console.error('이동할 게시글 ID를 찾을 수 없습니다.');
          }
        } else {
          console.error('이동할 게시글을 찾을 수 없습니다.');
        }
        return; // 이벤트 처리 완료
      }

      // "more" 버튼 클릭
      if (e.target.matches('.css-qtq074.e18x7bg02') || e.target.closest('.css-qtq074.e18x7bg02')) {
        e.preventDefault();
        loadMorePosts();
      }
      
      // "reply" 버튼 클릭
      if (e.target.classList.contains('reply') || e.target.closest('.reply')) {
        e.preventDefault();
        const postItem = e.target.closest('li');
        if (postItem) {
          const postId = postItem.dataset.postId;
          toggleComments(postItem, postId);
        }
      }
      
      // "like" 버튼 클릭
      if (e.target.classList.contains('like') || e.target.closest('.like')) {
        e.preventDefault();
        const likeButton = e.target.classList.contains('like') ? e.target : e.target.closest('.like');
        const isLiked = likeButton.dataset.liked === 'true';
        
        const listItem = likeButton.closest('li');
        if (listItem) {
          if (listItem.dataset.postId) {
            // 게시글 좋아요
            const postId = listItem.dataset.postId;
            if (isLiked) {
              unlikePost(postId, likeButton);
            } else {
              likePost(postId, likeButton);
            }
          } else if (listItem.dataset.commentId) {
            // 댓글 좋아요
            const commentId = listItem.dataset.commentId;
            if (isLiked) {
              unlikeComment(commentId, likeButton);
            } else {
              likeComment(commentId, likeButton);
            }
          }
        }
      }
      
      // "fold replies" 버튼 클릭
      if (e.target.classList.contains('css-rb1pwc') || e.target.closest('.css-rb1pwc')) {
        e.preventDefault();
        const postItem = e.target.closest('li');
        if (postItem) {
          hideComments(postItem);
        }
      }
      
      // "more replies" 버튼 클릭
      if (e.target.classList.contains('reply_more') || e.target.closest('.reply_more')) {
        e.preventDefault();
        const postItem = e.target.closest('li');
        if (postItem) {
          const postId = postItem.dataset.postId;
          loadMoreComments(postItem, postId);
        }
      }
      
      // 게시글 옵션 버튼 클릭
      if (e.target.matches('.css-9ktsbr') || e.target.closest('.css-9ktsbr')) {
        e.preventDefault();
        const optionsMenu = e.target.closest('.css-13q8c66')?.querySelector('.css-19v4su1, .css-16el6fj');
        if (optionsMenu) {
          queueDomOperation(async () => {
            if (optionsMenu.classList.contains('css-19v4su1')) {
              optionsMenu.classList.remove('css-19v4su1');
              optionsMenu.classList.add('css-16el6fj');
            } else {
              optionsMenu.classList.remove('css-16el6fj');
              optionsMenu.classList.add('css-19v4su1');
            }
            return true;
          });
        }
      }
      
      // "수정" 제출 버튼 클릭
      if (e.target.textContent === '수정' || (e.target.closest('a') && e.target.closest('a').textContent === '수정')) {
        e.preventDefault();
        const editForm = e.target.closest('.css-1t2q9uf');
        if (editForm) {
          const postItem = editForm.closest('li');
          const postId = postItem.dataset.postId;
          const textareaElement = editForm.querySelector('textarea');
          if (textareaElement) {
            const editedContent = textareaElement.value;
            submitEdit(postId, editedContent, postItem);
          }
        }
      }
      
      // "등록" 버튼 클릭 (댓글)
      if (e.target.textContent === '등록' || (e.target.closest('a') && e.target.closest('a').textContent === '등록')) {
        e.preventDefault();
        const commentForm = e.target.closest('.css-1cyfuwa');
        if (commentForm) {
          const postItem = commentForm.closest('li');
          const postId = postItem.dataset.postId;
          const textareaElement = commentForm.querySelector('textarea');
          if (textareaElement) {
            const commentContent = textareaElement.value;
            if (commentContent.trim()) {
              submitComment(postId, commentContent, postItem);
              textareaElement.value = '';
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in click event handler:', error);
    }
  }

  // 스크롤 이벤트 처리
  function handleScrollEvents() {
    try {
      // 새 글과 "더보기" 글 구분
      const customContainer = safeQuerySelector('#custom-entry-posts-list');
      if (customContainer) {
        const newPostsArea = safeQuerySelectorAll('li:not(.more-section)', customContainer);
        if (newPostsArea.length > 0) {
          const firstMorePost = safeQuerySelector('li.more-section', customContainer);
          if (firstMorePost) {
            const moreSectionTop = firstMorePost.getBoundingClientRect().top;
            isUserViewingNewPosts = moreSectionTop > window.innerHeight;
          }
        }
      }
      
      // 활성화된 댓글 스레드 확인
      for (const postId in activeCommentThreads) {
        const commentSection = safeQuerySelector(`li[data-post-id="${postId}"] .css-4e8bhg`);
        if (commentSection) {
          try {
            const rect = commentSection.getBoundingClientRect();
            activeCommentThreads[postId].isVisible = (
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight
            );
          } catch (rectError) {
            console.error('Error getting comment section rect:', rectError);
          }
        }
      }
    } catch (error) {
      console.error('Error in scroll event handler:', error);
    }
  }

  // 게시글 가져오기 및 새로고침 설정
  function startFetchingPosts(customContainer) {
    try {
      // 첫 게시글 가져오기 즉시 시작
      fetchPosts(customContainer, true).then(() => {
        // 이후 주기적 새로고침 설정
        setInterval(() => {
          try {
            if (isUserViewingNewPosts) {
              fetchPosts(customContainer, true);
            } else {
              // 표시된 스레드의 댓글 새로고침
              for (const postId in activeCommentThreads) {
                if (activeCommentThreads[postId].isVisible) {
                  const postElement = safeQuerySelector(`li[data-post-id="${postId}"]`, customContainer);
                  if (postElement) {
                    fetchComments(postId, postElement);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error in main refresh interval:', error);
          }
        }, REFRESH_INTERVAL);
        
        // 백그라운드 새로고침 (더 긴 간격)
        setInterval(() => {
          try {
            if (!isUserViewingNewPosts) {
              fetchPosts(customContainer, true);
            } else {
              // 보이지 않는 스레드의 댓글 새로고침
              for (const postId in activeCommentThreads) {
                if (!activeCommentThreads[postId].isVisible) {
                  const postElement = safeQuerySelector(`li[data-post-id="${postId}"]`, customContainer);
                  if (postElement) {
                    fetchComments(postId, postElement);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error in background refresh interval:', error);
          }
        }, BACKGROUND_REFRESH_INTERVAL);
        
        // 더보기 섹션 마커 동기화 (30초 간격)
        setInterval(() => {
          try {
            syncMoreSectionMarkers();
          } catch (error) {
            console.error('Error in more section sync interval:', error);
          }
        }, 30000);
      }).catch(error => {
        console.error('Error in initial fetchPosts:', error);
      });
    } catch (error) {
      console.error('Error in startFetchingPosts:', error);
    }
  }

  // 사용자 정보 가져오기
  async function fetchUserTopics() {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for fetchUserTopics');
        return '';
      }
      
      const response = await fetch("https://playentry.org/graphql/SELECT_TOPICS", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_TOPICS($pageParam: PageParam, $searchAfter: JSON){
                topicList(pageParam: $pageParam, searchAfter: $searchAfter) {
                    searchAfter
                    list {
                        id
                        params
                        template
                        thumbUrl
                        category
                        target
                        isRead
                        created
                        updated
                        link {
                            category
                            target
                            hash
                            groupId
                        }
                        topicinfo {
                            category
                            targetId
                        }
                    }
                }
            }
          `,
          variables: {
            pageParam: {
              display: 5
            }
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      if (data && data.data && data.data.topicList && data.data.topicList.list && data.data.topicList.list.length > 0) {
        const firstItem = data.data.topicList.list[0];
        if (firstItem && firstItem.target) {
          return firstItem.target;
        }
      }
      return '';
    } catch (error) {
      console.error('Error fetching user topics:', error);
      return '';
    }
  }

  // 게시글 가져오기
  async function fetchPosts(customContainer, isRecentLoad = false) {
    try {
      if (!csrfToken || !xToken || !customContainer) {
        console.log('Tokens or container not ready, cannot fetch posts');
        return;
      }

      // 현재 정렬 매개변수 로깅 (디버깅용)
      console.log(`fetchPosts 실행: sort=${sortParam}, isRecentLoad=${isRecentLoad}`);

      const requestOptions = {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_ENTRYSTORY(
                $pageParam: PageParam
                $query: String
                $user: String
                $category: String
                $term: String
                $prefix: String
                $progress: String
                $discussType: String
                $searchType: String
                $searchAfter: JSON
                $tag: String
            ){
                discussList(
                    pageParam: $pageParam
                    query: $query
                    user: $user
                    category: $category
                    term: $term
                    prefix: $prefix
                    progress: $progress
                    discussType: $discussType
                    searchType: $searchType
                    searchAfter: $searchAfter
                    tag: $tag
                ) {
                    total
                    list {
                        id
                        content
                        created
                        commentsLength
                        likesLength
                        user {
                            id
                            nickname
                            profileImage {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                            status {
                                following
                                follower
                            }
                            description
                            role
                            mark {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                        }
                        image {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        sticker {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        isLike
                    }
                    searchAfter
                }
            }
          `,
          variables: {
            category: "free",
            searchType: "scroll",
            term: termParam,
            discussType: "entrystory",
            query: queryParam || undefined,
            pageParam: {
              display: 10,
              sort: sortParam
            }
          }
        }),
        credentials: "include",
        referrer: window.location.href,
        referrerPolicy: "strict-origin-when-cross-origin"
      };

      try {
        const response = await fetchWithRetry("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions);
        
        if (!response.ok) {
          console.error('Server returned an error:', response.status, response.statusText);
          return;
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error('Response is not JSON, content type:', contentType);
          const textResponse = await response.text();
          console.error('Response text:', textResponse);
          
          if (textResponse.includes('form tampered with') || textResponse.includes('token')) {
            console.log('Token issue detected, refreshing tokens...');
            extractTokens();
          }
          return;
        }
        
        const data = await response.json();
        
        if (data && data.data && data.data.discussList && data.data.discussList.list) {
          let newPosts = data.data.discussList.list;
          currentSearchAfter = data.data.discussList.searchAfter;
          
          // 중요 수정: 모든 sort 값에 대해 최신글 역순 처리가 적용되도록 수정
          // isRecentLoad가 true일 때만 역순으로 처리하고, 더보기 섹션에서는 역순 처리 안함
          if (isRecentLoad && newPosts.length >= 2) {
            console.log(`게시글 정렬: 모든 정렬에서 최신글이 위에 오도록 역순 처리 (현재 정렬: ${sortParam})`);
            newPosts = [...newPosts].reverse();
          } else {
            console.log(`게시글 정렬: 더보기는 일반 순서 유지 (현재 정렬: ${sortParam}, 역순 처리 안함)`);
          }
          
          if (JSON.stringify(newPosts) !== JSON.stringify(latestPosts)) {
            console.log('New posts detected, updating UI');
            
            const postsListContainer = safeQuerySelector('#custom-entry-posts-list', customContainer);
            if (postsListContainer) {
              updatePosts(newPosts, postsListContainer);
              latestPosts = newPosts;
            } else {
              console.error('Posts list container not found, cannot update posts');
            }
          }
        } else if (data && data.errors) {
          console.error('GraphQL errors:', data.errors);
        }
      } catch (fetchError) {
        console.error('Fetch error in fetchPosts:', fetchError);
        
        if (fetchError instanceof SyntaxError) {
          console.log('JSON parsing error - likely a token issue. Refreshing tokens...');
          extractTokens();
        }
        
        if (fetchError instanceof TypeError && fetchError.message.includes('Failed to fetch')) {
          console.log('Network error detected - trying to re-initialize...');
          extractTokens();
        }
      }
    } catch (outerError) {
      console.error('Error in fetchPosts:', outerError);
    }
  }

  // 게시글 좋아요
  async function likePost(postId, element) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for likePost');
        return;
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/LIKE", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            mutation LIKE($target: String, $targetSubject: String, $targetType: String, $groupId: ID) {
              like(target: $target, targetSubject: $targetSubject, targetType: $targetType, groupId: $groupId) {
                target
                targetSubject
                targetType
              }
            }
          `,
          variables: {
            target: postId,
            targetSubject: "discuss"
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      
      if (data && data.data && data.data.like) {
        await queueDomOperation(async () => {
          if (document.contains(element)) {
            element.classList.add('active');
            element.dataset.liked = 'true';
            
            const likeText = element.textContent;
            const likeCount = parseInt(likeText.match(/\d+/)[0] || '0');
            element.textContent = `좋아요 ${likeCount + 1}`;
            
            updatePostLikeStatus(postId, true, likeCount + 1);
            return true;
          }
          return false;
        });
      }
    } catch (error) {
      console.error('Error liking post:', error);
    }
  }

  // 게시글 좋아요 취소
  async function unlikePost(postId, element) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for unlikePost');
        return;
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/UNLIKE", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            mutation UNLIKE($target: String, $groupId: ID) {
              unlike(target: $target, groupId: $groupId) {
                target
                targetSubject
                targetType
              }
            }
          `,
          variables: {
            target: postId,
            targetSubject: "discuss"
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      
      if (data && data.data && data.data.unlike) {
        await queueDomOperation(async () => {
          if (document.contains(element)) {
            element.classList.remove('active');
            element.dataset.liked = 'false';
            
            const likeText = element.textContent;
            const likeCount = parseInt(likeText.match(/\d+/)[0] || '0');
            element.textContent = `좋아요 ${Math.max(0, likeCount - 1)}`;
            
            updatePostLikeStatus(postId, false, Math.max(0, likeCount - 1));
            return true;
          }
          return false;
        });
      }
    } catch (error) {
      console.error('Error unliking post:', error);
    }
  }

  // 댓글 좋아요
  async function likeComment(commentId, element) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for likeComment');
        return;
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/LIKE", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            mutation LIKE($target: String, $targetSubject: String, $targetType: String, $groupId: ID) {
              like(target: $target, targetSubject: $targetSubject, targetType: $targetType, groupId: $groupId) {
                target
                targetSubject
                targetType
              }
            }
          `,
          variables: {
            target: commentId,
            targetSubject: "comment"
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      
      if (data && data.data && data.data.like) {
        await queueDomOperation(async () => {
          if (document.contains(element)) {
            element.classList.add('active');
            element.dataset.liked = 'true';
            
            const likeText = element.textContent;
            const likeCount = parseInt(likeText.match(/\d+/)[0] || '0');
            element.textContent = `좋아요 ${likeCount + 1}`;
            return true;
          }
          return false;
        });
      }
    } catch (error) {
      console.error('Error liking comment:', error);
    }
  }

  // 댓글 좋아요 취소
  async function unlikeComment(commentId, element) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for unlikeComment');
        return;
      }
      
      const response = await fetchWithRetry("https://playentry.org/graphql/UNLIKE", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            mutation UNLIKE($target: String, $groupId: ID) {
              unlike(target: $target, groupId: $groupId) {
                target
                targetSubject
                targetType
              }
            }
          `,
          variables: {
            target: commentId,
            targetSubject: "comment"
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      
      if (data && data.data && data.data.unlike) {
        await queueDomOperation(async () => {
          if (document.contains(element)) {
            element.classList.remove('active');
            element.dataset.liked = 'false';
            
            const likeText = element.textContent;
            const likeCount = parseInt(likeText.match(/\d+/)[0] || '0');
            element.textContent = `좋아요 ${Math.max(0, likeCount - 1)}`;
            return true;
          }
          return false;
        });
      }
    } catch (error) {
      console.error('Error unliking comment:', error);
    }
  }

  // 게시글 좋아요 상태 업데이트
  function updatePostLikeStatus(postId, isLiked, likesCount) {
    try {
      // latestPosts 배열 업데이트
      for (let i = 0; i < latestPosts.length; i++) {
        if (latestPosts[i].id === postId) {
          latestPosts[i].isLike = isLiked;
          latestPosts[i].likesLength = likesCount;
          break;
        }
      }
      
      // visibleMorePosts 배열 업데이트
      for (let i = 0; i < visibleMorePosts.length; i++) {
        if (visibleMorePosts[i].id === postId) {
          visibleMorePosts[i].isLike = isLiked;
          visibleMorePosts[i].likesLength = likesCount;
          break;
        }
      }
    } catch (error) {
      console.error('Error in updatePostLikeStatus:', error);
    }
  }

  // 게시글 UI 업데이트 - 수정됨: 게시글 제거 로직 제거
  async function updatePosts(posts, container) {
    try {
      if (!container) return;
      
      // 기존 게시글 맵핑
      const existingPostElements = safeQuerySelectorAll('li[data-post-id]', container);
      const existingPostsMap = new Map();
      
      existingPostElements.forEach(element => {
        try {
          const postId = element.dataset.postId;
          if (postId) {
            existingPostsMap.set(postId, element);
          }
        } catch (error) {
          console.error('Error mapping existing post:', error);
        }
      });
      
      // 현재 게시글 ID 추적
      const currentPostIds = new Set();
      
      // 각 게시글 처리
      for (const post of posts) {
        try {
          currentPostIds.add(post.id);
          
          if (existingPostsMap.has(post.id)) {
            // 기존 게시글 업데이트
            const existingElement = existingPostsMap.get(post.id);
            await updatePostContent(existingElement, post);
          } else {
            // 새 게시글 추가 - 항상 맨 위에 추가
            const postElement = createPostElement(post);
            
            // 첫 번째 자식 요소 앞에 삽입
            if (container.firstChild) {
              await safeInsertBefore(container, postElement, container.firstChild);
              console.log(`새 게시글 추가: ${post.id} (맨 위에 삽입)`);
            } else {
              await safeAppendChild(container, postElement);
              console.log(`새 게시글 추가: ${post.id} (첫 번째 게시글)`);
            }
          }
        } catch (error) {
          console.error('Error processing post:', error);
        }
      }
      
      // 삭제된 게시글 제거
      for (const [postId, element] of existingPostsMap.entries()) {
        try {
          if (!currentPostIds.has(postId) && !element.classList.contains('more-section')) {
            await safeRemoveElement(element);
          }
        } catch (error) {
          console.error('Error removing post:', error);
        }
      }
      
      // 여기서 게시글 제거 로직이 있었지만 제거되었습니다
    } catch (error) {
      console.error('Error in updatePosts:', error);
    }
  }
  
  // 게시글 요소 생성 - 수정됨: 게시글로 이동 버튼 추가
  function createPostElement(post) {
    try {
      const li = document.createElement('li');
      li.dataset.postId = post.id;
      li.className = post.user.id === userId ? 'css-1kivsx6 eelonj20' : 'css-1mswyjj eelonj20';
      li.dataset.customExtension = 'true'; // 커스텀 요소로 표시
      
      // 날짜 포맷
      const createdDate = new Date(post.created);
      const formattedDate = `${createdDate.getFullYear().toString().slice(2)}.${(createdDate.getMonth() + 1).toString().padStart(2, '0')}.${createdDate.getDate().toString().padStart(2, '0')} ・ ${createdDate.getHours().toString().padStart(2, '0')}:${createdDate.getMinutes().toString().padStart(2, '0')}`;
      
      // 프로필 이미지 URL
      let profileImageUrl = '/img/EmptyImage.svg';
      if (post.user.profileImage && post.user.profileImage.filename) {
        const firstTwo = post.user.profileImage.filename.substring(0, 2);
        const secondTwo = post.user.profileImage.filename.substring(2, 4);
        const filename = post.user.profileImage.filename;
        const extension = post.user.profileImage.imageType ? `.${post.user.profileImage.imageType.toLowerCase()}` : '';
        profileImageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
      }
      
      // 배지 확인
      let markHtml = '';
      if (post.user.mark && post.user.mark.filename) {
        const firstTwo = post.user.mark.filename.substring(0, 2);
        const secondTwo = post.user.mark.filename.substring(2, 4);
        const filename = post.user.mark.filename;
        const extension = post.user.mark.imageType ? `.${post.user.mark.imageType.toLowerCase()}` : '';
        const markImageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
        markHtml = `<span class="css-1b1jxqs ee2n3ac2" style="background-image: url(&quot;${markImageUrl}&quot;), url(&quot;/img/EmptyImage.svg&quot;);"><span class="blind">가드 배지</span></span>`;
      }
      
      // 옵션 메뉴 HTML - 수정됨: 게시글로 이동 버튼 추가
      const optionsHtml = post.user.id === userId 
        ? `<div class="css-19v4su1 e12alrlo0"><div class="css-1v3ka1a e1wvddxk0"><ul><li><a data-action="goto">게시글로 이동</a></li><li><a data-action="edit">수정하기</a></li><li><a data-action="delete">삭제하기</a></li></ul><span class="css-1s3ybmc e1wvddxk1"><i>&nbsp;</i></span></div></div>`
        : `<div class="css-19v4su1 e12alrlo0"><div class="css-1v3ka1a e1wvddxk0"><ul><li><a data-action="goto">게시글로 이동</a></li><li><a data-action="report">신고하기</a></li></ul><span class="css-1s3ybmc e1wvddxk1"><i>&nbsp;</i></span></div></div>`;
      
      // 좋아요 버튼 클래스
      const likeClass = post.isLike ? 'like active' : 'like';
      
      // 내용 안전하게 이스케이프
      const safeContent = safeHTML(post.content || '');
      
      // 스티커 HTML 생성
      let stickerHTML = '';
      if (post.sticker) {
        // 이미지 URL 생성
        let stickerUrl = '';
        if (post.sticker.filename) {
          const firstTwo = post.sticker.filename.substring(0, 2);
          const secondTwo = post.sticker.filename.substring(2, 4);
          const filename = post.sticker.filename;
          const extension = post.sticker.imageType ? `.${post.sticker.imageType.toLowerCase()}` : '';
          stickerUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
          
          stickerHTML = `<em class="css-18ro4ma e1877mpo0"><img src="${stickerUrl}" alt="sticker"></em>`;
        }
      }

      li.innerHTML = `
        <div class="css-puqjcw e1877mpo2">
          <a class="css-18bdrlk enx4swp0" href="/profile/${post.user.id}" style="background-image: url(&quot;${profileImageUrl}&quot;), url(&quot;/img/EmptyImage.svg&quot;);">
            <span class="blind">유저 썸네일</span>
          </a>
          <div class="css-1t19ptn ee2n3ac5">
            <a href="/profile/${post.user.id}">${markHtml}${safeHTML(post.user.nickname)}</a>
            <em>${formattedDate}</em>
          </div>
          <div class="css-6wq60h e1i41bku1">${safeContent}</div>
          ${stickerHTML}
          <div class="css-1dcwahm e15ke9c50">
            <em><a role="button" class="${likeClass}" data-liked="${post.isLike ? 'true' : 'false'}">좋아요 ${post.likesLength}</a></em>
            <em><a role="button" class="reply">댓글 ${post.commentsLength}</a></em>
          </div>
          <div class="css-13q8c66 e12alrlo2">
            <a role="button" class="css-9ktsbr e12alrlo1" style="display: block;">
              <span class="blind">더보기</span>
            </a>
            ${optionsHtml}
          </div>
        </div>
        <div></div>
      `;
      
      // 수정/삭제 버튼에 이벤트 리스너 추가
      addActionListeners(li, post.id);
      
      return li;
    } catch (error) {
      console.error('Error in createPostElement:', error);
      // 오류 발생 시 간단한 요소 반환
      const fallbackLi = document.createElement('li');
      fallbackLi.dataset.postId = post.id;
      fallbackLi.dataset.customExtension = 'true';
      fallbackLi.textContent = '[게시글 표시 오류]';
      return fallbackLi;
    }
  }

  // 더 많은 게시글 로드
  async function loadMorePosts() {
    try {
      if (!currentSearchAfter) return;
      
      if (!csrfToken || !xToken) {
        console.log('Tokens not ready yet, extracting again...');
        extractTokens();
        return;
      }

      const requestOptions = {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_ENTRYSTORY(
                $pageParam: PageParam
                $query: String
                $user: String
                $category: String
                $term: String
                $prefix: String
                $progress: String
                $discussType: String
                $searchType: String
                $searchAfter: JSON
                $tag: String
            ){
                discussList(
                    pageParam: $pageParam
                    query: $query
                    user: $user
                    category: $category
                    term: $term
                    prefix: $prefix
                    progress: $progress
                    discussType: $discussType
                    searchType: $searchType
                    searchAfter: $searchAfter
                    tag: $tag
                ) {
                    total
                    list {
                        id
                        content
                        created
                        commentsLength
                        likesLength
                        user {
                            id
                            nickname
                            profileImage {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                            status {
                                following
                                follower
                            }
                            description
                            role
                            mark {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                        }
                        image {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        sticker {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        isLike
                    }
                    searchAfter
                }
            }
          `,
          variables: {
            category: "free",
            searchType: "scroll",
            term: termParam,
            discussType: "entrystory",
            query: queryParam || undefined,
            searchAfter: currentSearchAfter,
            pageParam: {
              display: 10,
              sort: sortParam
            }
          }
        }),
        credentials: "include",
        referrer: window.location.href,
        referrerPolicy: "strict-origin-when-cross-origin"
      };

      const response = await fetchWithRetry("https://playentry.org/graphql/SELECT_ENTRYSTORY", requestOptions);
      
      if (!response.ok) {
        console.error('Server returned an error:', response.status, response.statusText);
        return;
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Response is not JSON, content type:', contentType);
        const textResponse = await response.text();
        console.error('Response text:', textResponse);
        
        if (textResponse.includes('form tampered with') || textResponse.includes('token')) {
          console.log('Token issue detected, refreshing tokens...');
          extractTokens();
        }
        return;
      }
      
      const data = await response.json();
      
      if (data && data.data && data.data.discussList && data.data.discussList.list) {
        const morePosts = data.data.discussList.list;
        currentSearchAfter = data.data.discussList.searchAfter;
        
        // 보이는 게시글 목록에 추가
        visibleMorePosts = [...visibleMorePosts, ...morePosts];
        
        // UI에 새 게시글 추가
        const customContainer = safeQuerySelector('#custom-entry-posts-list');
        if (customContainer) {
          await addMorePosts(morePosts, customContainer);
        }
      } else if (data && data.errors) {
        console.error('GraphQL errors:', data.errors);
      }
    } catch (error) {
      console.error('Error loading more posts:', error);
      
      if (error instanceof SyntaxError) {
        console.log('JSON parsing error - likely a token issue. Refreshing tokens...');
        extractTokens();
      }
      
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.log('Network error detected - trying to re-initialize...');
        extractTokens();
      }
    }
  }

  // 더 많은 게시글 UI에 추가 (수정됨)
  async function addMorePosts(posts, container) {
    try {
      if (!container) return;
      
      // 기존 게시글 맵핑하여 중복 방지
      const existingPostsMap = new Map();
      const existingPostElements = safeQuerySelectorAll('li', container);
      existingPostElements.forEach(element => {
        try {
          const postId = element.dataset.postId;
          if (postId) {
            existingPostsMap.set(postId, element);
          }
        } catch (error) {
          console.error('Error mapping existing post for addMorePosts:', error);
        }
      });
      
      // 섹션 마커가 없으면 생성 (필요한 경우)
      if (!safeQuerySelector('.more-section-marker', container)) {
        const sectionMarker = document.createElement('li');
        sectionMarker.className = 'more-section-marker';
        sectionMarker.style.display = 'none';
        sectionMarker.dataset.customExtension = 'true';
        await safeAppendChild(container, sectionMarker);
      }
      
      // 새 게시글만 추가 (더보기 섹션으로 표시)
      for (const post of posts) {
        try {
          if (!existingPostsMap.has(post.id)) {
            const postElement = createPostElement(post);
            postElement.classList.add('more-section');
            await safeAppendChild(container, postElement);
            console.log(`더보기 게시글 추가: ${post.id}`);
          } else {
            // 이미 있는 게시글이면 내용 업데이트
            const existingElement = existingPostsMap.get(post.id);
            if (!existingElement.classList.contains('more-section')) {
              await queueDomOperation(async () => {
                existingElement.classList.add('more-section');
                return true;
              });
            }
            await updatePostContent(existingElement, post);
          }
        } catch (error) {
          console.error('Error adding more post:', error);
        }
      }
    } catch (error) {
      console.error('Error in addMorePosts:', error);
    }
  }

  // 정기적으로 더보기 섹션 동기화하는 함수 (시간이 지나도 일관성 유지)
  function syncMoreSectionMarkers() {
    try {
      const container = safeQuerySelector('#custom-entry-posts-list');
      if (!container) return;
      
      // more-section 클래스를 가진 모든 게시글
      const moreSectionPosts = safeQuerySelectorAll('li.more-section', container);
      const moreSectionIds = new Set(Array.from(moreSectionPosts).map(el => el.dataset.postId).filter(id => id));
      
      // visibleMorePosts에 있는 ID 집합
      const visibleMorePostIds = new Set(visibleMorePosts.map(post => post.id));
      
      // 동기화: 더보기 섹션 클래스 추가 또는 제거
      const allPosts = safeQuerySelectorAll('li[data-custom-extension="true"]', container);
      for (const element of allPosts) {
        const postId = element.dataset.postId;
        if (!postId) continue;
        
        queueDomOperation(async () => {
          if (visibleMorePostIds.has(postId) && !moreSectionIds.has(postId)) {
            // visibleMorePosts에는 있지만 클래스는 없는 경우: 클래스 추가
            element.classList.add('more-section');
          } else if (!visibleMorePostIds.has(postId) && moreSectionIds.has(postId)) {
            // visibleMorePosts에는 없지만 클래스는 있는 경우: 클래스 제거
            element.classList.remove('more-section');
          }
          return true;
        });
      }
      
      console.log('더보기 섹션 마커 동기화 완료');
    } catch (error) {
      console.error('Error in syncMoreSectionMarkers:', error);
    }
  }

  // 댓글 토글
  async function toggleComments(postItem, postId) {
    try {
      const existingComments = safeQuerySelector('.css-4e8bhg', postItem);
      
      if (existingComments) {
        // 댓글이 이미 보여지고 있으면 숨김
        await hideComments(postItem);
      } else {
        // 댓글이 보이지 않으면 표시
        await showComments(postItem, postId);
      }
    } catch (error) {
      console.error('Error in toggleComments:', error);
    }
  }

  // 댓글 표시
  async function showComments(postItem, postId) {
    try {
      // 게시글 클래스를 댓글 확장 스타일로 변경
      const originalClassName = postItem.className;
      postItem.dataset.originalClassName = originalClassName;
      
      // CSS 클래스 변경 - 자신의 글이면 css-1j98i4t 클래스 사용
      await queueDomOperation(async () => {
        if (postItem.classList.contains('css-1kivsx6')) {
          // 자신의 글
          postItem.className = 'css-1j98i4t eelonj20';
        } else {
          // 타인의 글
          postItem.className = 'css-1psq3e8 eelonj20';
        }
        return true;
      });
      
      // 댓글 컨테이너 생성
      const commentsContainer = document.createElement('div');
      commentsContainer.className = 'css-4e8bhg euhmxlr2';
      commentsContainer.dataset.customExtension = 'true';
      commentsContainer.innerHTML = `
        <ul class="css-1e7cskh euhmxlr1" data-custom-extension="true"></ul>
        <div class="css-ahy3yn euhmxlr3" data-custom-extension="true">
          <div class="css-1cyfuwa e1h77j9v12" data-custom-extension="true">
            <div class="css-11v8s45 e1h77j9v1" data-custom-extension="true">
              <textarea id="Write" name="Write" placeholder="댓글을 입력해 주세요" style="height: 22px !important;"></textarea>
            </div>
            <div class="css-ljggwk e1h77j9v9" data-custom-extension="true">
              <div class="css-109f9np e1h77j9v7" data-custom-extension="true">
                <a role="button" class="css-1394o6u e1h77j9v5" data-custom-extension="true"><span class="blind">스티커</span></a>
              </div>
              <span class="css-11ofcmn e1h77j9v8" data-custom-extension="true">
                <a href="/" data-btn-type="login" data-testid="button" class="css-1adjw8a e13821ld2" data-custom-extension="true">등록</a>
              </span>
            </div>
          </div>
          <a href="/" role="button" class="active css-rb1pwc euhmxlr0" data-custom-extension="true">답글 접기</a>
        </div>
      `;
      
      // 두 번째 직접 자식 div (댓글 컨테이너용)
      const contentContainer = postItem.children[1];
      if (contentContainer && contentContainer.tagName === 'DIV') {
        // 기존 내용 지우기
        await safeSetInnerHTML(contentContainer, '');
        contentContainer.dataset.customExtension = 'true';
        await safeAppendChild(contentContainer, commentsContainer);
      } else {
        console.error('Cannot find proper container for comments');
      }
      
      // 활성 댓글 스레드 추적
      activeCommentThreads[postId] = {
        isVisible: true,
        lastCommentsCount: 0,
        searchAfter: null
      };
      
      // 댓글 가져오기
      await fetchComments(postId, postItem);
    } catch (error) {
      console.error('Error in showComments:', error);
    }
  }

  // 댓글 숨기기
  async function hideComments(postItem) {
    try {
      const commentsContainer = postItem.children[1];
      const postId = postItem.dataset.postId;
      
      // 원래 클래스 복원
      if (postItem.dataset.originalClassName) {
        await queueDomOperation(async () => {
          postItem.className = postItem.dataset.originalClassName;
          return true;
        });
      }
      
      // 활성 스레드에서 제거
      if (postId in activeCommentThreads) {
        delete activeCommentThreads[postId];
      }
      
      // 댓글 지우기
      if (commentsContainer && commentsContainer.tagName === 'DIV') {
        await safeSetInnerHTML(commentsContainer, '');
      } else {
        console.error('Cannot find proper comments container to clear');
      }
    } catch (error) {
      console.error('Error in hideComments:', error);
    }
  }

  // 댓글 가져오기
  async function fetchComments(postId, postItem) {
    try {
      if (!csrfToken || !xToken) {
        console.log('Tokens not ready yet, extracting again...');
        extractTokens();
        return;
      }
      
      const requestOptions = {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_COMMENTS(
                $pageParam: PageParam
                $target: String
                $searchAfter: JSON
                $likesLength: Int
                $groupId: ID
            ){
                commentList(
                    pageParam: $pageParam
                    target: $target
                    searchAfter: $searchAfter
                    likesLength: $likesLength
                    groupId: $groupId
                ) {
                    total
                    searchAfter
                    likesLength
                    list {
                        id
                        user {
                            id
                            nickname
                            profileImage {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                            status {
                                following
                                follower
                            }
                            description
                            role
                            mark {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                        }
                        content
                        created
                        removed
                        blamed
                        blamedBy
                        commentsLength
                        likesLength
                        isLike
                        hide
                        pinned
                        image {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        sticker {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                    }
                }
            }
          `,
          variables: {
            target: postId,
            pageParam: {
              display: 10,
              sort: "created",
              order: 1
            }
          }
        }),
        credentials: "include",
        referrer: window.location.href,
        referrerPolicy: "strict-origin-when-cross-origin"
      };
      
      const response = await fetchWithRetry("https://playentry.org/graphql/SELECT_COMMENTS", requestOptions);
      
      if (!response.ok) {
        console.error('Server returned an error when fetching comments:', response.status, response.statusText);
        return;
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('Comments response is not JSON, content type:', contentType);
        const textResponse = await response.text();
        console.error('Comments response text:', textResponse);
        
        if (textResponse.includes('form tampered with') || textResponse.includes('token')) {
          console.log('Token issue detected, refreshing tokens...');
          extractTokens();
        }
        return;
      }
      
      const data = await response.json();
      
      if (data && data.data && data.data.commentList) {
        const comments = data.data.commentList.list;
        const searchAfter = data.data.commentList.searchAfter;
        const total = data.data.commentList.total;
        
        // 활성 스레드에 저장
        if (postId in activeCommentThreads) {
          activeCommentThreads[postId].searchAfter = searchAfter;
          activeCommentThreads[postId].lastCommentsCount = comments.length;
          activeCommentThreads[postId].total = total;
        }
        
        // UI에 댓글 업데이트
        await updateComments(postItem, comments, total > comments.length);
      } else if (data && data.errors) {
        console.error('GraphQL errors when fetching comments:', data.errors);
      }
    } catch (error) {
      console.error('Error fetching comments:', error);
      
      if (error instanceof SyntaxError) {
        console.log('JSON parsing error in comments - likely a token issue. Refreshing tokens...');
        extractTokens();
      }
      
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.log('Network error detected in comments - trying to re-initialize...');
        extractTokens();
      }
    }
  }

  // 댓글 UI 업데이트
  async function updateComments(postItem, comments, hasMore) {
    try {
      // 두 번째 자식 div에서 댓글 목록 찾기
      const commentsDiv = postItem.children[1];
      if (!commentsDiv || !safeQuerySelector('.css-4e8bhg', commentsDiv)) {
        console.error('Cannot find comments container');
        return;
      }
      
      const commentsList = safeQuerySelector('.css-1e7cskh', commentsDiv);
      if (!commentsList) {
        console.error('Cannot find comments list container');
        return;
      }
      
      // 기존 댓글 맵핑
      const existingCommentsMap = new Map();
      const existingCommentElements = safeQuerySelectorAll('li', commentsList);
      existingCommentElements.forEach(element => {
        try {
          const commentId = element.dataset.commentId;
          if (commentId) {
            existingCommentsMap.set(commentId, element);
          }
        } catch (error) {
          console.error('Error mapping existing comment:', error);
        }
      });
      
      // 현재 댓글 ID 추적
      const currentCommentIds = new Set();
      
      // 댓글 추가 또는 업데이트
      for (const comment of comments) {
        try {
          currentCommentIds.add(comment.id);
          
          if (existingCommentsMap.has(comment.id)) {
            // 기존 댓글 업데이트
            await updateCommentContent(existingCommentsMap.get(comment.id), comment);
          } else {
            // 새 댓글 추가
            const commentElement = createCommentElement(comment);
            await safeAppendChild(commentsList, commentElement);
          }
        } catch (error) {
          console.error('Error processing comment:', error);
        }
      }
      
      // 삭제된 댓글 제거
      for (const [commentId, element] of existingCommentsMap.entries()) {
        try {
          if (!currentCommentIds.has(commentId)) {
            await safeRemoveElement(element);
          }
        } catch (error) {
          console.error('Error removing comment:', error);
        }
      }
      
      // "더 보기" 버튼 추가
      const commentsContainer = safeQuerySelector('.css-ahy3yn', commentsDiv);
      if (commentsContainer) {
        try {
          // 기존 "더 보기" 버튼 제거
          const existingMoreButton = safeQuerySelector('.replay_inner', commentsContainer);
          if (existingMoreButton) {
            await safeRemoveElement(existingMoreButton);
          }
          
          // 필요한 경우 새 버튼 추가
          if (hasMore) {
            const moreButton = document.createElement('div');
            moreButton.className = 'replay_inner';
            moreButton.innerHTML = '<a href="/" role="button" class="reply_more">답글 더 보기</a>';
            await safeInsertBefore(commentsContainer, moreButton, commentsContainer.firstChild);
          }
        } catch (error) {
          console.error('Error updating more comments button:', error);
        }
      }
    } catch (error) {
      console.error('Error in updateComments:', error);
    }
  }
  
  // 댓글 내용 업데이트
  async function updateCommentContent(element, comment) {
    try {
      if (!element || !document.contains(element)) return;
      
      // 내용 업데이트
      const contentElement = safeQuerySelector('.css-6wq60h', element);
      if (contentElement && contentElement.textContent !== comment.content) {
        await safeSetTextContent(contentElement, comment.content);
      }
      
      // 좋아요 수와 상태 업데이트
      const likesElement = safeQuerySelector('.like', element);
      if (likesElement) {
        const currentLikes = parseInt(likesElement.textContent.match(/\d+/)[0] || '0');
        const currentLikedState = likesElement.dataset.liked === 'true';
        
        // 좋아요 수 업데이트
        if (currentLikes !== comment.likesLength) {
          await safeSetTextContent(likesElement, `좋아요 ${comment.likesLength}`);
        }
        
        // 좋아요 상태 업데이트
        if (currentLikedState !== comment.isLike) {
          await queueDomOperation(async () => {
            likesElement.dataset.liked = comment.isLike ? 'true' : 'false';
            if (comment.isLike) {
              likesElement.classList.add('active');
            } else {
              likesElement.classList.remove('active');
            }
            return true;
          });
        }
      }
    } catch (error) {
      console.error('Error in updateCommentContent:', error);
    }
  }

  // 댓글 요소 생성 - 수정됨: 게시글로 이동 버튼 추가
  function createCommentElement(comment) {
    try {
      const li = document.createElement('li');
      li.className = 'css-u1nrp7 e9nkex10';
      li.dataset.commentId = comment.id;
      li.dataset.customExtension = 'true';
      
      // 날짜 포맷
      const createdDate = new Date(comment.created);
      const formattedDate = `${createdDate.getFullYear().toString().slice(2)}.${(createdDate.getMonth() + 1).toString().padStart(2, '0')}.${createdDate.getDate().toString().padStart(2, '0')} ・ ${createdDate.getHours().toString().padStart(2, '0')}:${createdDate.getMinutes().toString().padStart(2, '0')}`;
      
      // 프로필 이미지 URL
      let profileImageUrl = '/img/EmptyImage.svg';
      if (comment.user.profileImage && comment.user.profileImage.filename) {
        const firstTwo = comment.user.profileImage.filename.substring(0, 2);
        const secondTwo = comment.user.profileImage.filename.substring(2, 4);
        const filename = comment.user.profileImage.filename;
        const extension = comment.user.profileImage.imageType ? `.${comment.user.profileImage.imageType.toLowerCase()}` : '';
        profileImageUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
      }
      
      // 옵션 메뉴 HTML (사용자 자신의 댓글인지에 따라 다름)
      const optionsHtml = comment.user.id === userId 
        ? `<div class=" css-19v4su1 e12alrlo0" data-custom-extension="true"><div href="" class="css-1v3ka1a e1wvddxk0" data-custom-extension="true"><ul data-custom-extension="true"><li data-custom-extension="true"><a href="/" data-custom-extension="true">수정하기</a></li><li data-custom-extension="true"><a href="/" data-custom-extension="true">삭제하기</a></li></ul><span class="css-1s3ybmc e1wvddxk1" data-custom-extension="true"><i data-custom-extension="true">&nbsp;</i></span></div></div>`
        : `<div class=" css-19v4su1 e12alrlo0" data-custom-extension="true"><div href="" class="css-1v3ka1a e1wvddxk0" data-custom-extension="true"><ul data-custom-extension="true"><li data-custom-extension="true"><a data-custom-extension="true">신고하기</a></li></ul><span class="css-1s3ybmc e1wvddxk1" data-custom-extension="true"><i data-custom-extension="true">&nbsp;</i></span></div></div>`;
      
      // 좋아요 버튼 클래스
      const likeClass = comment.isLike ? 'like active' : 'like';
      
      // 내용 안전하게 이스케이프
      const safeContent = safeHTML(comment.content || '');
      
      // 스티커 HTML 생성
      let stickerHTML = '';
      if (comment.sticker) {
        // 이미지 URL 생성
        let stickerUrl = '';
        if (comment.sticker.filename) {
          const firstTwo = comment.sticker.filename.substring(0, 2);
          const secondTwo = comment.sticker.filename.substring(2, 4);
          const filename = comment.sticker.filename;
          const extension = comment.sticker.imageType ? `.${comment.sticker.imageType.toLowerCase()}` : '';
          stickerUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
          
          stickerHTML = `<em class="css-18ro4ma e1877mpo0"><img src="${stickerUrl}" alt="sticker"></em>`;
        }
      }

      li.innerHTML = `
        <div class="css-uu8yq6 e3yf6l22" data-custom-extension="true">
          <a class=" css-16djw2l enx4swp0" href="/profile/${comment.user.id}" style="background-image: url(&quot;${profileImageUrl}&quot;), url(&quot;/img/EmptyImage.svg&quot;);" data-custom-extension="true">
            <span class="blind" data-custom-extension="true">유저 썸네일</span>
          </a>
          <div class="css-1t19ptn ee2n3ac5" data-custom-extension="true">
            <a href="/profile/${comment.user.id}" data-custom-extension="true">${safeHTML(comment.user.nickname)}</a>
            <em data-custom-extension="true">${formattedDate}</em>
          </div>
          <div class="css-6wq60h e1i41bku1" data-custom-extension="true">${safeContent}</div>
          ${stickerHTML}
          <div class="css-1dcwahm e15ke9c50" data-custom-extension="true">
            <em data-custom-extension="true"><a role="button" class="${likeClass}" data-custom-extension="true" data-liked="${comment.isLike ? 'true' : 'false'}">좋아요 ${comment.likesLength}</a></em>
          </div>
          <div class="css-13q8c66 e12alrlo2" data-custom-extension="true">
            <a href="/" role="button" class=" css-9ktsbr e12alrlo1" style="display: block;" data-custom-extension="true">
              <span class="blind" data-custom-extension="true">더보기</span>
            </a>
            ${optionsHtml}
          </div>
        </div>
      `;
      
      return li;
    } catch (error) {
      console.error('Error in createCommentElement:', error);
      const fallbackLi = document.createElement('li');
      fallbackLi.dataset.commentId = comment.id;
      fallbackLi.dataset.customExtension = 'true';
      fallbackLi.textContent = '[댓글 표시 오류]';
      return fallbackLi;
    }
  }

  // 더 많은 댓글 로드
  async function loadMoreComments(postItem, postId) {
    try {
      if (!(postId in activeCommentThreads) || !activeCommentThreads[postId].searchAfter) return;
      
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for loadMoreComments');
        return;
      }
      
      const response = await fetch("https://playentry.org/graphql/SELECT_COMMENTS", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify({
          query: `
            query SELECT_COMMENTS(
                $pageParam: PageParam
                $target: String
                $searchAfter: JSON
                $likesLength: Int
                $groupId: ID
            ){
                commentList(
                    pageParam: $pageParam
                    target: $target
                    searchAfter: $searchAfter
                    likesLength: $likesLength
                    groupId: $groupId
                ) {
                    total
                    searchAfter
                    likesLength
                    list {
                        id
                        user {
                            id
                            nickname
                            profileImage {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                            status {
                                following
                                follower
                            }
                            description
                            role
                            mark {
                                id
                                name
                                label {
                                    ko
                                    en
                                    ja
                                    vn
                                }
                                filename
                                imageType
                                dimension {
                                    width
                                    height
                                }
                                trimmed {
                                    filename
                                    width
                                    height
                                }
                            }
                        }
                        content
                        created
                        removed
                        blamed
                        blamedBy
                        commentsLength
                        likesLength
                        isLike
                        hide
                        pinned
                        image {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                        sticker {
                            id
                            name
                            label {
                                ko
                                en
                                ja
                                vn
                            }
                            filename
                            imageType
                            dimension {
                                width
                                height
                            }
                            trimmed {
                                filename
                                width
                                height
                            }
                        }
                    }
                }
            }
          `,
          variables: {
            target: postId,
            pageParam: {
              display: 10,
              sort: "created",
              order: 1
            },
            searchAfter: activeCommentThreads[postId].searchAfter
          }
        }),
        credentials: "include"
      });
      
      const data = await response.json();
      
      if (data && data.data && data.data.commentList) {
        const newComments = data.data.commentList.list;
        const searchAfter = data.data.commentList.searchAfter;
        const total = data.data.commentList.total;
        
        // 활성 스레드에 저장
        if (postId in activeCommentThreads) {
          activeCommentThreads[postId].searchAfter = searchAfter;
          activeCommentThreads[postId].lastCommentsCount += newComments.length;
        }
        
        // UI에 추가
        await addMoreComments(postItem, newComments, activeCommentThreads[postId].lastCommentsCount < total);
      }
    } catch (error) {
      console.error('Error loading more comments:', error);
    }
  }

  // 더 많은 댓글 UI에 추가
  async function addMoreComments(postItem, comments, hasMore) {
    try {
      const commentsDiv = postItem.children[1];
      if (!commentsDiv || !safeQuerySelector('.css-4e8bhg', commentsDiv)) {
        console.error('Cannot find comments container for adding more comments');
        return;
      }
      
      const commentsList = safeQuerySelector('.css-1e7cskh', commentsDiv);
      if (!commentsList) {
        console.error('Cannot find comments list container for adding more comments');
        return;
      }
      
      // 기존 댓글 맵핑하여 중복 방지
      const existingCommentsMap = new Map();
      const existingCommentElements = safeQuerySelectorAll('li', commentsList);
      existingCommentElements.forEach(element => {
        try {
          const commentId = element.dataset.commentId;
          if (commentId) {
            existingCommentsMap.set(commentId, element);
          }
        } catch (error) {
          console.error('Error mapping existing comment for addMoreComments:', error);
        }
      });
      
      // 새 댓글만 추가
      for (const comment of comments) {
        try {
          if (!existingCommentsMap.has(comment.id)) {
            const commentElement = createCommentElement(comment);
            await safeAppendChild(commentsList, commentElement);
          } else {
            // 이미 있는 댓글이면 내용 업데이트
            await updateCommentContent(existingCommentsMap.get(comment.id), comment);
          }
        } catch (error) {
          console.error('Error adding more comment:', error);
        }
      }
      
      // "더 보기" 버튼 업데이트
      const commentsContainer = safeQuerySelector('.css-ahy3yn', commentsDiv);
      if (commentsContainer) {
        try {
          // 기존 버튼 제거
          const existingMoreButton = safeQuerySelector('.replay_inner', commentsContainer);
          if (existingMoreButton) {
            await safeRemoveElement(existingMoreButton);
          }
          
          // 필요한 경우 새 버튼 추가
          if (hasMore) {
            const moreButton = document.createElement('div');
            moreButton.className = 'replay_inner';
            moreButton.innerHTML = '<a href="/" role="button" class="reply_more">답글 더 보기</a>';
            await safeInsertBefore(commentsContainer, moreButton, commentsContainer.firstChild);
          }
        } catch (error) {
          console.error('Error updating more comments button in addMoreComments:', error);
        }
      }
    } catch (error) {
      console.error('Error in addMoreComments:', error);
    }
  }

  // 편집 폼 표시 함수
async function showEditForm(postItem, postId, content) {
  try {
    console.log('수정 폼 표시 시작 - 게시글 ID:', postId);
    console.log('수정할 내용:', content);  // 디버깅용
    
    // content가 undefined나 null이면 빈 문자열로 설정
    content = content || '';
    
    // 편집 폼 생성
    const editForm = document.createElement('div');
    editForm.className = 'css-1t2q9uf e13giesq0';
    editForm.dataset.customExtension = 'true';
    
    // 내용 안전하게 이스케이프
    const safeContent = safeHTML(content);
    
    editForm.innerHTML = `
      <div class="css-1cyfuwa e1h77j9v12" data-custom-extension="true">
        <div class="css-11v8s45 e1h77j9v1" data-custom-extension="true">
          <textarea id="Write" name="Write" style="height: 22px !important;">${safeContent}</textarea>
        </div>
        <div class="css-ljggwk e1h77j9v9" data-custom-extension="true">
          <div class="css-109f9np e1h77j9v7" data-custom-extension="true">
            <a role="button" class="css-1394o6u e1h77j9v5" data-custom-extension="true"><span class="blind">스티커</span></a>
          </div>
          <span class="css-11ofcmn e1h77j9v8" data-custom-extension="true">
            <a data-btn-type="login" data-testid="button" class="css-1adjw8a e13821ld2" data-custom-extension="true">수정</a>
          </span>
        </div>
      </div>
    `;
    
    // 복원을 위해 원래 내용 저장
    postItem.dataset.originalContent = postItem.innerHTML;
    console.log('원본 내용 저장 완료');
    
    // 게시글 내용을 편집 폼으로 교체
    await safeSetInnerHTML(postItem, '');
    console.log('기존 내용 지우기 완료');
    
    await queueDomOperation(async () => {
      postItem.className = 'css-15iqo0v e13giesq1';
      return true;
    });
    console.log('클래스 변경 완료');
    
    await safeAppendChild(postItem, editForm);
    console.log('편집 폼 추가 완료');
    
    // 스티커 확인 (필요한 경우)
    const post = latestPosts.find(p => p.id === postId) || visibleMorePosts.find(p => p.id === postId);
    if (post && post.sticker) {
      // 원본 게시글에서 스티커 탭 ID 및 아이템 ID 가져오기
      // 실제 탭 ID는 API 응답에서 추출해야 할 수 있음
      temporaryPostSticker = post.sticker.id; // 이 부분은 API 응답에 따라 다를 수 있음
      temporaryPostStickerItem = post.sticker.id;
      
      // 이미지 URL 생성
      let stickerUrl = '';
      if (post.sticker.filename) {
        const firstTwo = post.sticker.filename.substring(0, 2);
        const secondTwo = post.sticker.filename.substring(2, 4);
        const filename = post.sticker.filename;
        const extension = post.sticker.imageType ? `.${post.sticker.imageType.toLowerCase()}` : '';
        stickerUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
        
        // 스티커 표시
        const stickerContainer = document.createElement('div');
        stickerContainer.className = 'css-fjfa6z e1h77j9v3';
        stickerContainer.dataset.customExtension = 'true';
        stickerContainer.innerHTML = `
          <em>
            <img src="${stickerUrl}" alt="게시글 첨부 스티커" style="width: 105px; height: 105px;">
            <a href="/" role="button" class="remove-sticker-btn">
              <span class="blind">스티커 닫기</span>
            </a>
          </em>
        `;
        
        // 폼에 추가
        const formContainer = editForm.querySelector('.css-1cyfuwa');
        if (formContainer) {
          await safeAppendChild(formContainer, stickerContainer);
        }
        
        // 스티커 제거 버튼 이벤트
        const removeButton = stickerContainer.querySelector('.remove-sticker-btn');
        if (removeButton) {
          removeButton.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            temporaryPostSticker = null;
            temporaryPostStickerItem = null;
            safeRemoveElement(stickerContainer);
          });
        }
      }
    }
    
    // 수정 버튼 이벤트 리스너 추가
    const submitButton = editForm.querySelector('.css-1adjw8a');
    if (submitButton) {
      submitButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const textarea = editForm.querySelector('textarea');
        if (textarea) {
          submitEdit(postId, textarea.value, postItem);
        }
      });
    }
  } catch (error) {
    console.error('Error in showEditForm:', error);
  }
}

  // 편집된 게시글 제출
  async function submitEdit(postId, content, postItem) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for submitEdit');
        return;
      }
      
      // 디버깅용 로그 추가
      console.log('수정 요청 - 스티커 탭:', temporaryPostSticker, '스티커 아이템:', temporaryPostStickerItem);
      
      const requestBody = {
        query: `
          mutation REPAIR_ENTRYSTORY(
              $id: ID, 
              $content: String, 
              $image: String, 
              $sticker: ID,
              $stickerItem: ID
          ){
              repairEntryStory(
                  id: $id, 
                  content: $content, 
                  image: $image, 
                  sticker: $sticker,
                  stickerItem: $stickerItem
              ){
                  id
                  content
                  created
                  commentsLength
                  likesLength
                  user {
                      id
                      nickname
                      profileImage {
                          id
                          filename
                      }
                  }
                  sticker {
                    id
                    name
                    filename
                    imageType
                  }
              }
          }
        `,
        variables: {
          id: postId,
          content: content
        }
      };
      
      // 스티커가 있는 경우에만 포함
      if (temporaryPostSticker) {
        requestBody.variables.sticker = temporaryPostSticker;
      }
      
      if (temporaryPostStickerItem) {
        requestBody.variables.stickerItem = temporaryPostStickerItem;
      }
      
      console.log('수정 요청 데이터:', JSON.stringify(requestBody));
      
      const response = await fetch("https://playentry.org/graphql/REPAIR_ENTRYSTORY", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify(requestBody),
        credentials: "include"
      });
      
      const responseText = await response.text();
      console.log('수정 응답:', responseText);
      
      try {
        const data = JSON.parse(responseText);
        
        if (data && data.data && data.data.repairEntryStory) {
          // 원래 배열에서 게시글 찾아 업데이트
          const updatedPost = data.data.repairEntryStory;
          for (let i = 0; i < latestPosts.length; i++) {
            if (latestPosts[i].id === postId) {
              latestPosts[i].content = updatedPost.content;
              latestPosts[i].sticker = updatedPost.sticker;
              break;
            }
          }
          
          // visibleMorePosts 배열에도 업데이트
          for (let i = 0; i < visibleMorePosts.length; i++) {
            if (visibleMorePosts[i].id === postId) {
              visibleMorePosts[i].content = updatedPost.content;
              visibleMorePosts[i].sticker = updatedPost.sticker;
              break;
            }
          }
          
          // 원래 요소 복원하고 내용 업데이트
          await safeSetInnerHTML(postItem, postItem.dataset.originalContent);
          await queueDomOperation(async () => {
            postItem.className = userId === updatedPost.user.id ? 'css-1kivsx6 eelonj20' : 'css-1mswyjj eelonj20';
            return true;
          });
          
          const contentElement = findPostContent(postItem);
          if (contentElement) {
            await safeSetTextContent(contentElement, updatedPost.content);
          }
          
          // 스티커 업데이트
          if (updatedPost.sticker) {
            const stickerContainer = document.createElement('em');
            stickerContainer.className = 'css-18ro4ma e1877mpo0';
            
            // 이미지 URL 생성
            let stickerUrl = '';
            if (updatedPost.sticker.filename) {
              const firstTwo = updatedPost.sticker.filename.substring(0, 2);
              const secondTwo = updatedPost.sticker.filename.substring(2, 4);
              const filename = updatedPost.sticker.filename;
              const extension = updatedPost.sticker.imageType ? `.${updatedPost.sticker.imageType.toLowerCase()}` : '';
              stickerUrl = `/uploads/${firstTwo}/${secondTwo}/${filename}${extension}`;
              
              stickerContainer.innerHTML = `<img src="${stickerUrl}" alt="sticker">`;
              
              // 스티커 삽입 (내용 다음)
              const contentParent = contentElement.parentElement;
              if (contentParent) {
                await safeInsertBefore(contentParent, stickerContainer, contentElement.nextSibling);
              }
            }
          }
          
          // 임시 스티커 상태 초기화
          temporaryPostSticker = null;
          temporaryPostStickerItem = null;
        }
      } catch (parseError) {
        console.error('수정 응답 파싱 오류:', parseError);
      }
    } catch (error) {
      console.error('Error submitting edit:', error);
      // 원래 게시글 복원
      if (postItem.dataset.originalContent) {
        await safeSetInnerHTML(postItem, postItem.dataset.originalContent);
        await queueDomOperation(async () => {
          postItem.className = 'css-1mswyjj eelonj20';
          return true;
        });
      }
    }
  }

  // 게시글 삭제 - 완전히 개선됨
  async function deletePost(postId, postItem) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for deletePost');
        return;
      }
      
      console.log('삭제 요청 시작 - ID:', postId);
      console.log('삭제 요청 시 CSRF 토큰:', csrfToken.substring(0, 10) + '...');
      console.log('삭제 요청 시 X 토큰:', xToken.substring(0, 10) + '...');
      
      // GraphQL 요청 데이터 - ID 타입을 ID! (필수)로 변경
      const requestBody = {
        query: `
          mutation REMOVE_DISCUSS($id: ID!) {
              removeDiscuss(id: $id){
                  id
              }
          }
        `,
        variables: {
          id: postId
        }
      };
      
      console.log('삭제 요청 데이터:', JSON.stringify(requestBody));
      
      const response = await fetch("https://playentry.org/graphql/REMOVE_DISCUSS", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify(requestBody),
        credentials: "include"
      });
      
      console.log('삭제 응답 상태:', response.status, response.statusText);
      
      const responseText = await response.text();
      console.log('삭제 응답 전문:', responseText);
      
      try {
        const data = JSON.parse(responseText);
        console.log('삭제 응답 파싱된 데이터:', data);
        
        if (data && data.data && data.data.removeDiscuss) {
          // 배열에서 제거
          latestPosts = latestPosts.filter(post => post.id !== postId);
          visibleMorePosts = visibleMorePosts.filter(post => post.id !== postId);
          
          // UI에서 제거
          await safeRemoveElement(postItem);
          console.log('게시글 삭제 완료:', postId);
        } else if (data && data.errors) {
          console.error('삭제 중 GraphQL 오류:', data.errors);
        }
      } catch (parseError) {
        console.error('삭제 응답 파싱 오류:', parseError);
      }
    } catch (error) {
      console.error('Error deleting post:', error);
    }
  }

  // 댓글 제출
  async function submitComment(postId, content, postItem) {
    try {
      if (!csrfToken || !xToken) {
        console.error('Tokens not available for submitComment');
        return;
      }
      
      // 디버깅용 로그 추가
      console.log('댓글 작성 요청 - 스티커 탭:', temporaryCommentSticker, '스티커 아이템:', temporaryCommentStickerItem);
      
      const requestBody = {
        query: `
          mutation CREATE_COMMENT(
              $content: String
              $image: String
              $sticker: ID
              $stickerItem: ID
              $target: String
              $targetSubject: String
              $targetType: String
              $groupId: ID
          ) {
              createComment(
                  content: $content
                  image: $image
                  sticker: $sticker
                  stickerItem: $stickerItem
                  target: $target
                  targetSubject: $targetSubject
                  targetType: $targetType
                  groupId: $groupId
              ) {
                  warning
                  comment {
                      id
                      user {
                          id
                          nickname
                          profileImage {
                              id
                              filename
                          }
                      }
                      content
                      created
                      likesLength
                      sticker {
                        id
                        name
                        filename
                        imageType
                      }
                  }
              }
          }
        `,
        variables: {
          content: content,
          target: postId,
          targetSubject: "discuss",
          targetType: "individual"
        }
      };
      
      // 스티커가 있는 경우에만 포함
      if (temporaryCommentSticker) {
        requestBody.variables.sticker = temporaryCommentSticker;
      }
      
      if (temporaryCommentStickerItem) {
        requestBody.variables.stickerItem = temporaryCommentStickerItem;
      }
      
      console.log('댓글 요청 데이터:', JSON.stringify(requestBody));
      
      const response = await fetch("https://playentry.org/graphql/CREATE_COMMENT", {
        method: "POST",
        headers: {
          "accept": "*/*",
          "content-type": "application/json",
          "csrf-token": csrfToken,
          "x-token": xToken,
          "x-client-type": "Client"
        },
        body: JSON.stringify(requestBody),
        credentials: "include"
      });
      
      const responseText = await response.text();
      console.log('댓글 응답:', responseText);
      
      try {
        const data = JSON.parse(responseText);
        
        if (data && data.data && data.data.createComment && data.data.createComment.comment) {
          // 댓글 수 업데이트
          for (let i = 0; i < latestPosts.length; i++) {
            if (latestPosts[i].id === postId) {
              latestPosts[i].commentsLength++;
              break;
            }
          }
          
          for (let i = 0; i < visibleMorePosts.length; i++) {
            if (visibleMorePosts[i].id === postId) {
              visibleMorePosts[i].commentsLength++;
              break;
            }
          }
          
          // UI에서 댓글 수 업데이트
          const commentCountElement = safeQuerySelector('.reply', postItem);
          if (commentCountElement) {
            const currentCount = parseInt(commentCountElement.textContent.match(/\d+/)[0] || '0');
            await safeSetTextContent(commentCountElement, `댓글 ${currentCount + 1}`);
          }
          
          // 댓글 새로고침
          await fetchComments(postId, postItem);
          
          // 임시 스티커 상태 초기화
          temporaryCommentSticker = null;
          temporaryCommentStickerItem = null;
        }
      } catch (parseError) {
        console.error('댓글 응답 파싱 오류:', parseError);
      }
    } catch (error) {
      console.error('Error submitting comment:', error);
    }
  }

  // 안전한 URL 변경 리스너 설정
  function setupUrlChangeListener() {
    try {
      if (observerInitialized) return;
      
      let lastUrl = window.location.href;
      
      const observer = new MutationObserver(() => {
        try {
          const url = window.location.href;
          if (url !== lastUrl) {
            lastUrl = url;
            console.log('URL changed, resetting extension');
            
            // 초기화 상태 리셋
            isInitialized = false;
            csrfToken = '';
            xToken = '';
            userId = '';
            latestPosts = [];
            visibleMorePosts = [];
            activeCommentThreads = {};
            currentSearchAfter = null;
            isUserViewingNewPosts = true;
            initializationAttempts = 0;
            containerReady = false;
            
            // URL 매개변수 업데이트
            urlParams = new URLSearchParams(window.location.search);
            
            // URL에서 매개변수 추출
            const newSortParam = urlParams.get('sort') || 'created';
            const newTermParam = urlParams.get('term') || 'all';
            const newQueryParam = urlParams.get('query') || '';
            
            // 변경된 경우에만 업데이트
            if (newSortParam !== sortParam || newTermParam !== termParam || newQueryParam !== queryParam) {
              // 전역 매개변수 업데이트
              sortParam = newSortParam;
              termParam = newTermParam;
              queryParam = newQueryParam;
              
              console.log(`URL params updated: sort=${sortParam}, term=${termParam}, query=${queryParam}`);
            }
            
            // DOM 조작 큐 초기화
            pendingDomOperations = [];
            isProcessingDomQueue = false;
            
            // 즉시 초기화 시작
            safeInit();
          }
        } catch (error) {
          console.error('Error in URL change observer callback:', error);
        }
      });
      
      // 문서 변경 관찰
      observer.observe(document, {subtree: true, childList: true});
      observerInitialized = true;
    } catch (error) {
      console.error('Error setting up URL change listener:', error);
    }
  }

  // 초기화 즉시 시작
  setupUrlChangeListener();
  safeInit();
  
  // 문서가 이미 로드된 상태인지 확인하고 아직 초기화되지 않았으면 다시 시도
  if (document.readyState === 'complete' && !isInitialized) {
    console.log('Document already loaded but not initialized, trying again');
    safeInit();
  }
})();