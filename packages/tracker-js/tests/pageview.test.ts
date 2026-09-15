import { init, pageview, track, trackViews } from '../src/index'
import { Lib } from '../src/Lib'
import { setLocation } from './testUtils'

jest.mock('../src/Lib', () => {
  const originalModule = jest.requireActual('../src/Lib')

  return {
    ...originalModule,
    Lib: class MockLib extends originalModule.Lib {
      sendRequest = jest.fn().mockResolvedValue(undefined)
    },
  }
})

describe('Pageview Tracking', () => {
  const PROJECT_ID = 'test-project-id'
  let libInstance: Lib

  beforeEach(() => {
    jest.clearAllMocks()

    libInstance = init(PROJECT_ID, { devMode: true }) as Lib

    setLocation({ hostname: 'example.com', pathname: '/test-page' })

    Object.defineProperty(document, 'referrer', {
      value: 'https://google.com',
      writable: true,
      configurable: true,
    })
  })

  test('pageview function should track a page view', async () => {
    // Arrange
    const path = '/test-page'

    // Act
    pageview({
      payload: { pg: path },
      unique: false,
    })

    // Assert
    expect((libInstance as any).sendRequest).toHaveBeenCalledTimes(1)
    expect((libInstance as any).sendRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pid: PROJECT_ID,
        pg: path,
      }),
    )
  })

  test('pageview function should set the page later events are attributed to', async () => {
    // Arrange
    const path = '/orders/42'

    // Act
    pageview({ payload: { pg: path } })
    track({ ev: 'order_placed' })

    // Assert
    expect((libInstance as any).sendRequest).toHaveBeenLastCalledWith(
      'custom',
      expect.objectContaining({
        ev: 'order_placed',
        pg: path,
      }),
    )
  })

  test('pageview function with unique flag should track unique page view', async () => {
    // Arrange
    const path = '/test-page'

    // Act
    pageview({
      payload: { pg: path },
      unique: true,
    })

    // Assert
    expect((libInstance as any).sendRequest).toHaveBeenCalledTimes(1)
    expect((libInstance as any).sendRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pid: PROJECT_ID,
        pg: path,
        unique: true,
      }),
    )
  })

  test('pageview function with metadata should include metadata in request', async () => {
    // Arrange
    const path = '/test-page'
    const metadata = {
      category: 'blog',
      author: 'John Doe',
    }

    // Act
    pageview({
      payload: {
        pg: path,
        meta: metadata,
      },
      unique: false,
    })

    // Assert
    expect((libInstance as any).sendRequest).toHaveBeenCalledTimes(1)
    expect((libInstance as any).sendRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pid: PROJECT_ID,
        pg: path,
        meta: metadata,
      }),
    )
  })

  test('trackViews should start tracking page views', async () => {
    // Mock the trackPageViews method
    ;(libInstance as any).trackPageViews = jest.fn().mockReturnValue({
      stop: jest.fn(),
    })

    // Act
    await trackViews()

    // Assert
    expect((libInstance as any).trackPageViews).toHaveBeenCalledTimes(1)
  })
})
