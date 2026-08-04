using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Features.Users.Commands.UpdateRank;
using Awake.Domain.Entities;
using Awake.Domain.Enums;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Users;

public class UpdateUserRankCommandHandlerTests
{
    private static readonly Guid Actor = Guid.NewGuid();
    private static readonly Guid Target = Guid.NewGuid();

    private readonly Mock<IUserRepository> _users = new();
    private readonly Mock<ICurrentUserService> _currentUser = new();

    public UpdateUserRankCommandHandlerTests()
    {
        _currentUser.SetupGet(x => x.UserId).Returns(Actor);
        _currentUser.SetupGet(x => x.Rank).Returns(UserRank.Colonel);
    }

    private UpdateUserRankCommandHandler BuildHandler()
        => new(_users.Object, _currentUser.Object);

    private User GivenTarget(UserRank rank, Guid? id = null)
    {
        var user = new User { Id = id ?? Target, Username = "цель", Rank = rank };
        _users.Setup(x => x.GetByIdAsync(user.Id, It.IsAny<CancellationToken>())).ReturnsAsync(user);
        return user;
    }

    private void VerifyUntouched() =>
        _users.Verify(x => x.UpdateAsync(It.IsAny<User>(), It.IsAny<CancellationToken>()), Times.Never);

    [Fact]
    public async Task Handle_LowerRankedTarget_IsUpdated()
    {
        var target = GivenTarget(UserRank.Member);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, UserRank.Officer), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        target.Rank.Should().Be(UserRank.Officer);
        _users.Verify(x => x.UpdateAsync(target, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_ColonelDemotingLeader_IsRejected()
    {
        GivenTarget(UserRank.Leader);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, UserRank.Guest), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }

    [Fact]
    public async Task Handle_OfficerDemotingColonel_IsRejected()
    {
        _currentUser.SetupGet(x => x.Rank).Returns(UserRank.Officer);
        GivenTarget(UserRank.Colonel);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, UserRank.Member), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }

    [Fact]
    public async Task Handle_PeerOfSameRank_IsRejected()
    {
        GivenTarget(UserRank.Colonel);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, UserRank.Member), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }

    /// <summary>Потолок повышения — ступень под собственной.</summary>
    [Theory]
    [InlineData(UserRank.Officer, UserRank.Member)]
    [InlineData(UserRank.Colonel, UserRank.Officer)]
    [InlineData(UserRank.Leader, UserRank.Colonel)]
    public async Task Handle_HighestGrantableRank_IsOneStepBelowOwn(UserRank actor, UserRank ceiling)
    {
        _currentUser.SetupGet(x => x.Rank).Returns(actor);
        var target = GivenTarget(UserRank.Guest);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, ceiling), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        target.Rank.Should().Be(ceiling);
    }

    [Theory]
    [InlineData(UserRank.Officer, UserRank.Officer)]
    [InlineData(UserRank.Colonel, UserRank.Colonel)]
    [InlineData(UserRank.Colonel, UserRank.Leader)]
    [InlineData(UserRank.Leader, UserRank.Leader)]
    public async Task Handle_RankAtOrAboveOwn_IsRejected(UserRank actor, UserRank granted)
    {
        _currentUser.SetupGet(x => x.Rank).Returns(actor);
        GivenTarget(UserRank.Guest);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, granted), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }

    [Fact]
    public async Task Handle_OwnRank_IsRejected()
    {
        GivenTarget(UserRank.Colonel, Actor);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Actor, UserRank.Member), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }

    [Fact]
    public async Task Handle_UnknownUser_IsRejected()
    {
        _users.Setup(x => x.GetByIdAsync(Target, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);

        var result = await BuildHandler().Handle(
            new UpdateUserRankCommand(Target, UserRank.Member), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        VerifyUntouched();
    }
}
